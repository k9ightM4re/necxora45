import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import {
  buildDisplayMediaConstraintsList,
  buildPeerConnectionConfig,
  detectScreenShareSupport,
  shouldInitiateOffer,
} from './comms.js';
import { formatFriendlyError } from './notifications.js';

export function createRtcManager({ db, auth, onStateChange, onToast, onScreenShareFallback }) {
  const peerConnections = new Map(); // remoteUid -> RTCPeerConnection
  const remoteStreams = new Map(); // remoteUid -> MediaStream
  const iceCandidateQueues = new Map(); // remoteUid -> RTCIceCandidateInit[]
  const handledSignals = new Set();
  const speakingUids = new Set();
  const analysers = new Map(); // uid -> AnalyserNode
  let audioCtx = null;
  let speakingInterval = null;
  let ringtoneInterval = null;

  function startRingtone() {
    if (ringtoneInterval) return;
    try {
      const AudioCtxClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtxClass) return;
      const ctx = audioCtx || new AudioCtxClass();
      if (ctx.state === 'suspended') ctx.resume().catch(() => {});
      audioCtx = ctx;

      const playBeep = () => {
        try {
          const osc1 = ctx.createOscillator();
          const osc2 = ctx.createOscillator();
          const gain = ctx.createGain();

          osc1.type = 'sine';
          osc1.frequency.value = 440;
          osc2.type = 'sine';
          osc2.frequency.value = 480;

          gain.gain.setValueAtTime(0.12, ctx.currentTime);
          gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 1.2);

          osc1.connect(gain);
          osc2.connect(gain);
          gain.connect(ctx.destination);

          osc1.start();
          osc2.start();
          osc1.stop(ctx.currentTime + 1.2);
          osc2.stop(ctx.currentTime + 1.2);
        } catch {}
      };

      playBeep();
      ringtoneInterval = window.setInterval(playBeep, 3000);
    } catch {}
  }

  function stopRingtone() {
    if (ringtoneInterval) {
      clearInterval(ringtoneInterval);
      ringtoneInterval = null;
    }
  }

  let unsubGlobalCalls = null;
  let unsubCallDoc = null;
  let unsubPeers = null;
  let unsubSignals = null;
  let globalUid = '';

  const state = {
    activeCall: null, // { id, kind, targetId, title, peerUserId, sessionId, mode, status, startedAtMs }
    incomingCall: null, // { id, kind, targetId, callerId, callerName, mode, participantIds }
    lastEndedCall: null, // { id, sessionId, kind, targetId, title, peerUserId, mode, startedAtMs, endedAtMs, durationSec, endedByRemote }
    localStream: null,
    screenStream: null,
    peers: [], // array from /calls/{id}/peers
    micAvailable: false,
    camAvailable: false,
    muted: false,
    deafened: false,
    videoOn: false,
    screenSharing: false,
    screenShareKind: '', // '' | 'display' | 'board' | 'photo'
    cameraFacing: 'user', // 'user' | 'environment'
    handRaised: false,
    noiseSuppression: true,
    echoCancellation: true,
    autoGainControl: true,
    audioInputId: '',
    audioOutputId: '',
    videoInputId: '',
    devices: { mics: [], speakers: [], cams: [] },
    mediaNotice: '',
  };

  function emit() {
    if (typeof onStateChange === 'function') {
      onStateChange({
        ...state,
        remoteStreams,
        speakingUids,
      });
    }
  }

  function setupAudioAnalyzer(uid, stream) {
    if (!uid || !stream || stream.getAudioTracks().length === 0) return;
    try {
      if (!audioCtx) {
        const AudioCtxClass = window.AudioContext || window.webkitAudioContext;
        if (AudioCtxClass) audioCtx = new AudioCtxClass();
      }
      if (!audioCtx) return;
      if (audioCtx.state === 'suspended') {
        audioCtx.resume().catch(() => {});
      }
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      analysers.set(uid, analyser);
    } catch {}
  }

  function startSpeakingLoop() {
    if (speakingInterval) return;
    speakingInterval = window.setInterval(() => {
      const nextSpeaking = new Set();
      const myUid = auth.currentUser?.uid;

      if (myUid && state.localStream && !state.muted) {
        const localAnalyser = analysers.get(myUid);
        if (localAnalyser) {
          const data = new Uint8Array(localAnalyser.frequencyBinCount);
          localAnalyser.getByteFrequencyData(data);
          const avg = data.reduce((a, b) => a + b, 0) / data.length;
          if (avg > 14) nextSpeaking.add(myUid);
        }
      }

      for (const [remoteUid, stream] of remoteStreams.entries()) {
        const remoteAnalyser = analysers.get(remoteUid);
        if (remoteAnalyser && stream.getAudioTracks().length > 0) {
          const data = new Uint8Array(remoteAnalyser.frequencyBinCount);
          remoteAnalyser.getByteFrequencyData(data);
          const avg = data.reduce((a, b) => a + b, 0) / data.length;
          if (avg > 14) nextSpeaking.add(remoteUid);
        }
      }

      let changed = speakingUids.size !== nextSpeaking.size;
      if (!changed) {
        for (const id of nextSpeaking) {
          if (!speakingUids.has(id)) {
            changed = true;
            break;
          }
        }
      }

      if (changed) {
        speakingUids.clear();
        for (const id of nextSpeaking) speakingUids.add(id);
        emit();
      }
    }, 180);
  }

  function stopSpeakingLoop() {
    if (speakingInterval) {
      clearInterval(speakingInterval);
      speakingInterval = null;
    }
    speakingUids.clear();
    analysers.clear();
  }

  function toast(msg) {
    if (typeof onToast === 'function') onToast(msg);
  }

  async function refreshDevices() {
    if (!navigator.mediaDevices?.enumerateDevices) return state.devices;
    try {
      const list = await navigator.mediaDevices.enumerateDevices();
      state.devices = {
        mics: list.filter((d) => d.kind === 'audioinput'),
        speakers: list.filter((d) => d.kind === 'audiooutput'),
        cams: list.filter((d) => d.kind === 'videoinput'),
      };
      emit();
    } catch {}
    return state.devices;
  }

  function buildAudioConstraints() {
    const base = {
      noiseSuppression: Boolean(state.noiseSuppression),
      echoCancellation: Boolean(state.echoCancellation),
      autoGainControl: Boolean(state.autoGainControl),
    };
    if (state.audioInputId) {
      base.deviceId = { exact: state.audioInputId };
    }
    return base;
  }

  function buildVideoConstraints() {
    const base = {
      width: { ideal: 1280 },
      height: { ideal: 720 },
    };
    if (state.videoInputId) {
      base.deviceId = { exact: state.videoInputId };
    } else {
      base.facingMode = { ideal: state.cameraFacing || 'user' };
    }
    return base;
  }

  function clearCallSubscriptions() {
    if (unsubCallDoc) {
      unsubCallDoc();
      unsubCallDoc = null;
    }
    if (unsubPeers) {
      unsubPeers();
      unsubPeers = null;
    }
    if (unsubSignals) {
      unsubSignals();
      unsubSignals = null;
    }
  }

  function closePeerConnection(remoteUid) {
    const pc = peerConnections.get(remoteUid);
    if (pc) {
      try {
        pc.ontrack = null;
        pc.onicecandidate = null;
        pc.onconnectionstatechange = null;
        pc.close();
      } catch {}
      peerConnections.delete(remoteUid);
    }
    remoteStreams.delete(remoteUid);
    iceCandidateQueues.delete(remoteUid);
  }

  function stopStreamTracks(stream) {
    if (!stream) return;
    stream.getTracks().forEach((t) => {
      try {
        t.onended = null;
        t.stop();
      } catch {}
    });
  }

  async function writeSignal(callId, toUid, type, extra = {}) {
    const fromUid = auth.currentUser?.uid;
    if (!fromUid || !toUid || !callId) return;
    const signalId = `sig_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const payload = {
      id: signalId,
      callId,
      fromUid,
      toUid,
      type,
      createdAt: serverTimestamp(),
      ...extra,
    };
    try {
      await setDoc(doc(db, 'calls', callId, 'signals', signalId), payload);
    } catch (err) {
      console.warn('RTC signal send skipped:', err?.message);
    }
  }

  async function syncPeerDoc(callId, profile) {
    const uid = auth.currentUser?.uid;
    if (!uid || !callId) return;
    const peerRef = doc(db, 'calls', callId, 'peers', uid);
    const data = {
      userId: uid,
      callId,
      displayName: String(profile?.displayName || 'Member').slice(0, 80),
      initials: String(profile?.initials || 'MB').slice(0, 16),
      muted: Boolean(state.muted),
      videoOn: Boolean(state.videoOn),
      screenSharing: Boolean(state.screenSharing),
      handRaised: Boolean(state.handRaised),
      updatedAt: serverTimestamp(),
    };
    try {
      const snap = await getDoc(peerRef);
      if (!snap.exists()) {
        await setDoc(peerRef, {
          ...data,
          joinedAt: serverTimestamp(),
        });
      } else {
        await updateDoc(peerRef, {
          displayName: data.displayName,
          initials: data.initials,
          muted: data.muted,
          videoOn: data.videoOn,
          screenSharing: data.screenSharing,
          handRaised: data.handRaised,
          updatedAt: serverTimestamp(),
        });
      }
    } catch (err) {
      console.warn('Peer state sync warning:', err?.message);
    }
  }

  function attachLocalTracksToPc(pc) {
    const existingTracks = new Set(pc.getSenders().map((s) => s.track).filter(Boolean));
    if (state.localStream) {
      state.localStream.getTracks().forEach((track) => {
        if (!existingTracks.has(track)) {
          pc.addTrack(track, state.localStream);
        }
      });
    }
    if (state.screenStream) {
      state.screenStream.getTracks().forEach((track) => {
        if (!existingTracks.has(track)) {
          pc.addTrack(track, state.screenStream);
        }
      });
    }
  }

  function ensurePeerConnection(callId, remoteUid) {
    if (peerConnections.has(remoteUid)) return peerConnections.get(remoteUid);
    if (typeof RTCPeerConnection === 'undefined') return null;

    const pc = new RTCPeerConnection(buildPeerConnectionConfig());
    peerConnections.set(remoteUid, pc);

    attachLocalTracksToPc(pc);

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        writeSignal(callId, remoteUid, 'ice', {
          candidate: {
            candidate: event.candidate.candidate || '',
            sdpMid: event.candidate.sdpMid ?? '',
            sdpMLineIndex: event.candidate.sdpMLineIndex ?? 0,
          },
        });
      }
    };

    pc.ontrack = (event) => {
      let stream = remoteStreams.get(remoteUid);
      if (!stream) {
        stream = new MediaStream();
        remoteStreams.set(remoteUid, stream);
      }
      const incomingStream = event.streams && event.streams[0];
      if (incomingStream) {
        incomingStream.getTracks().forEach((t) => {
          if (!stream.getTracks().some((existing) => existing.id === t.id)) {
            stream.addTrack(t);
          }
        });
      } else if (event.track) {
        if (!stream.getTracks().some((existing) => existing.id === event.track.id)) {
          stream.addTrack(event.track);
        }
      }
      setupAudioAnalyzer(remoteUid, stream);
      startSpeakingLoop();
      event.track.onended = () => {
        emit();
      };
      emit();
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
        emit();
      }
    };

    return pc;
  }

  async function sendOfferToPeer(callId, remoteUid) {
    const pc = ensurePeerConnection(callId, remoteUid);
    if (!pc) return;
    try {
      if (pc.signalingState !== 'stable') return;
      const offer = await pc.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: true,
      });
      await pc.setLocalDescription(offer);
      await writeSignal(callId, remoteUid, 'offer', {
        sdp: offer.sdp || '',
      });
    } catch (err) {
      console.warn('Offer creation error:', err?.message);
    }
  }

  async function renegotiateAllPeers() {
    const callId = state.activeCall?.id;
    const myUid = auth.currentUser?.uid;
    if (!callId || !myUid) return;
    for (const [remoteUid, pc] of peerConnections.entries()) {
      attachLocalTracksToPc(pc);
      try {
        if (pc.signalingState === 'stable') {
          const offer = await pc.createOffer({
            offerToReceiveAudio: true,
            offerToReceiveVideo: true,
          });
          await pc.setLocalDescription(offer);
          await writeSignal(callId, remoteUid, 'offer', {
            sdp: offer.sdp || '',
          });
        }
      } catch (err) {
        console.warn('Renegotiation warning:', err?.message);
      }
    }
  }

  async function handleIncomingSignal(callId, sigId, sig) {
    if (handledSignals.has(sigId)) return;
    handledSignals.add(sigId);

    const fromUid = sig.fromUid;
    if (!fromUid || fromUid === auth.currentUser?.uid) return;

    const pc = ensurePeerConnection(callId, fromUid);
    if (!pc) return;

    try {
      if (sig.type === 'offer' && sig.sdp) {
        await pc.setRemoteDescription(new RTCSessionDescription({ type: 'offer', sdp: sig.sdp }));
        attachLocalTracksToPc(pc);
        const queued = iceCandidateQueues.get(fromUid) || [];
        for (const c of queued) {
          await pc.addIceCandidate(new RTCIceCandidate(c)).catch(() => {});
        }
        iceCandidateQueues.delete(fromUid);

        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        await writeSignal(callId, fromUid, 'answer', {
          sdp: answer.sdp || '',
        });
      } else if (sig.type === 'answer' && sig.sdp) {
        if (pc.signalingState === 'have-local-offer') {
          await pc.setRemoteDescription(new RTCSessionDescription({ type: 'answer', sdp: sig.sdp }));
          const queued = iceCandidateQueues.get(fromUid) || [];
          for (const c of queued) {
            await pc.addIceCandidate(new RTCIceCandidate(c)).catch(() => {});
          }
          iceCandidateQueues.delete(fromUid);
        }
      } else if (sig.type === 'ice' && sig.candidate) {
        if (pc.remoteDescription) {
          await pc.addIceCandidate(new RTCIceCandidate(sig.candidate)).catch(() => {});
        } else {
          const q = iceCandidateQueues.get(fromUid) || [];
          q.push(sig.candidate);
          iceCandidateQueues.set(fromUid, q);
        }
      }
    } catch (err) {
      console.warn('Signal handling error:', err?.message);
    } finally {
      deleteDoc(doc(db, 'calls', callId, 'signals', sigId)).catch(() => {});
    }
  }

  async function acquireMedia({ withVideo = false, muted = false } = {}) {
    state.mediaNotice = '';
    if (!navigator.mediaDevices?.getUserMedia) {
      state.micAvailable = false;
      state.camAvailable = false;
      state.videoOn = false;
      state.mediaNotice = 'Connected in viewer/listen-only mode (microphone API unavailable).';
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: buildAudioConstraints(),
        video: withVideo ? buildVideoConstraints() : false,
      });
      state.localStream = stream;
      state.micAvailable = stream.getAudioTracks().length > 0;
      state.camAvailable = stream.getVideoTracks().length > 0;
      state.videoOn = state.camAvailable;
      stream.getAudioTracks().forEach((t) => {
        t.enabled = !muted;
      });
      setupAudioAnalyzer(auth.currentUser?.uid, stream);
      startSpeakingLoop();
      refreshDevices();
    } catch (firstErr) {
      if (withVideo) {
        try {
          const audioOnly = await navigator.mediaDevices.getUserMedia({ audio: buildAudioConstraints(), video: false });
          state.localStream = audioOnly;
          state.micAvailable = audioOnly.getAudioTracks().length > 0;
          state.camAvailable = false;
          state.videoOn = false;
          audioOnly.getAudioTracks().forEach((t) => {
            t.enabled = !muted;
          });
          state.mediaNotice = 'Camera unavailable — joined with audio.';
          toast('Camera unavailable — joined with microphone audio.');
          refreshDevices();
          return;
        } catch {}
      }
      state.localStream = null;
      state.micAvailable = false;
      state.camAvailable = false;
      state.videoOn = false;
      const reason = firstErr?.name === 'NotAllowedError'
        ? 'Microphone permission denied — joined in listen/viewer mode.'
        : 'No microphone hardware detected — joined in listen/viewer mode.';
      state.mediaNotice = reason;
      toast(reason);
      refreshDevices();
    }
  }

  async function updateAudioSettings(next = {}) {
    if (typeof next.noiseSuppression === 'boolean') state.noiseSuppression = next.noiseSuppression;
    if (typeof next.echoCancellation === 'boolean') state.echoCancellation = next.echoCancellation;
    if (typeof next.autoGainControl === 'boolean') state.autoGainControl = next.autoGainControl;
    if (typeof next.audioInputId === 'string') state.audioInputId = next.audioInputId;
    if (typeof next.audioOutputId === 'string') state.audioOutputId = next.audioOutputId;
    if (typeof next.videoInputId === 'string') state.videoInputId = next.videoInputId;

    if (state.localStream) {
      const audioTracks = state.localStream.getAudioTracks();
      if (next.audioInputId !== undefined && navigator.mediaDevices?.getUserMedia) {
        try {
          const nextStream = await navigator.mediaDevices.getUserMedia({ audio: buildAudioConstraints(), video: false });
          const nextTrack = nextStream.getAudioTracks()[0];
          if (nextTrack) {
            nextTrack.enabled = !state.muted;
            audioTracks.forEach((old) => {
              state.localStream.removeTrack(old);
              old.stop();
            });
            state.localStream.addTrack(nextTrack);
            for (const pc of peerConnections.values()) {
              const sender = pc.getSenders().find((s) => s.track && s.track.kind === 'audio');
              if (sender) await sender.replaceTrack(nextTrack).catch(() => {});
            }
          }
        } catch {}
      } else {
        for (const t of audioTracks) {
          if (typeof t.applyConstraints === 'function') {
            await t.applyConstraints(buildAudioConstraints()).catch(() => {});
          }
        }
      }
    }
    emit();
  }

  function initGlobalCallListener(uid) {
    if (globalUid === uid && unsubGlobalCalls) return;
    if (unsubGlobalCalls) {
      unsubGlobalCalls();
      unsubGlobalCalls = null;
    }
    globalUid = uid;
    if (!uid) return;

    const q = query(collection(db, 'calls'), where('participantIds', 'array-contains', uid));
    unsubGlobalCalls = onSnapshot(
      q,
      (snap) => {
        let nextIncoming = null;
        snap.forEach((docSnap) => {
          const d = docSnap.data();
          if (
            d.kind === 'dm' &&
            d.status === 'ringing' &&
            d.callerId !== uid &&
            (!state.activeCall || state.activeCall.id !== docSnap.id)
          ) {
            nextIncoming = { id: docSnap.id, ...d };
          }
        });
        const prevIncoming = state.incomingCall;
        const changed =
          (prevIncoming?.id || '') !== (nextIncoming?.id || '') ||
          prevIncoming?.mode !== nextIncoming?.mode;
        state.incomingCall = nextIncoming;
        if (nextIncoming && !prevIncoming) {
          startRingtone();
        } else if (!nextIncoming && prevIncoming) {
          stopRingtone();
        }
        if (changed) emit();
      },
      () => {}
    );
  }

  async function joinCall({
    callId,
    kind,
    targetId,
    title,
    currentUserProfile,
    targetPeerProfile = null,
    withVideo = false,
    withScreen = false,
    muted = false,
    deafened = false,
    handRaised = false,
    allowReview = undefined,
  }) {
    const uid = auth.currentUser?.uid;
    if (!uid || !callId) return false;

    if (state.activeCall && state.activeCall.id === callId) {
      if (withScreen && !state.screenSharing) {
        await startScreenShare(currentUserProfile);
      } else if (withVideo && !state.videoOn) {
        await toggleCamera(currentUserProfile);
      }
      return true;
    }

    await leaveCall({ skipReview: true });

    state.lastEndedCall = null;
    state.muted = Boolean(muted);
    state.deafened = Boolean(deafened);
    state.handRaised = Boolean(handRaised);
    state.videoOn = Boolean(withVideo);
    state.screenSharing = false;
    state.incomingCall = null;

    await acquireMedia({ withVideo, muted: state.muted });

    const callRef = doc(db, 'calls', callId);
    const participantIds =
      kind === 'dm' && targetPeerProfile?.id
        ? Array.from(new Set([uid, targetPeerProfile.id])).slice(0, 25)
        : [uid];

    const mode = withScreen ? 'screen' : state.videoOn ? 'video' : 'audio';
    let sessionId = `cs-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

    try {
      const callSnap = await getDoc(callRef);
      if (!callSnap.exists()) {
        await setDoc(callRef, {
          id: callId,
          kind,
          targetId,
          callerId: uid,
          callerName: String(currentUserProfile?.displayName || 'Member').slice(0, 80),
          calleeId: String(targetPeerProfile?.id || ''),
          sessionId,
          participantIds,
          mode,
          status: kind === 'dm' ? 'ringing' : 'active',
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      } else {
        const prev = callSnap.data();
        const mergedParticipants = Array.from(
          new Set([...(Array.isArray(prev.participantIds) ? prev.participantIds : []), ...participantIds])
        ).slice(0, 25);

        const isNewDmRing = kind === 'dm' && prev.status === 'ended';
        if (!isNewDmRing && prev.sessionId) {
          sessionId = String(prev.sessionId);
        }
        await updateDoc(callRef, {
          status: isNewDmRing ? 'ringing' : 'active',
          mode,
          sessionId,
          ...(isNewDmRing
            ? {
                callerId: uid,
                callerName: String(currentUserProfile?.displayName || 'Member').slice(0, 80),
              }
            : {}),
          participantIds: mergedParticipants,
          updatedAt: serverTimestamp(),
        });
      }
    } catch (err) {
      toast(formatFriendlyError(err, 'You cannot start this live call right now. Please try again.'));
      stopStreamTracks(state.localStream);
      state.localStream = null;
      return false;
    }

    state.activeCall = {
      id: callId,
      kind,
      targetId,
      title: title || 'Live Room',
      peerUserId: targetPeerProfile?.id || '',
      sessionId,
      mode,
      status: 'active',
      startedAtMs: Date.now(),
      allowReview: typeof allowReview === 'boolean' ? allowReview : kind === 'dm' || kind === 'meeting',
    };

    await syncPeerDoc(callId, currentUserProfile);

    unsubCallDoc = onSnapshot(
      callRef,
      (snap) => {
        if (!snap.exists()) return;
        const d = snap.data();
        if (d.sessionId && state.activeCall?.id === callId && state.activeCall.sessionId !== d.sessionId) {
          state.activeCall = { ...state.activeCall, sessionId: String(d.sessionId) };
          emit();
        }
        if (d.status === 'ended' && d.kind === 'dm' && state.activeCall?.id === callId) {
          toast('Call ended');
          leaveCall({ skipStatusUpdate: true });
        }
      },
      () => {}
    );

    unsubPeers = onSnapshot(
      query(collection(db, 'calls', callId, 'peers'), where('callId', '==', callId)),
      (snap) => {
        const list = [];
        const activeRemoteIds = new Set();
        snap.forEach((docSnap) => {
          const d = docSnap.data();
          list.push(d);
          if (d.userId && d.userId !== uid) {
            activeRemoteIds.add(d.userId);
          }
        });
        state.peers = list;

        for (const existingRemoteId of Array.from(peerConnections.keys())) {
          if (!activeRemoteIds.has(existingRemoteId)) {
            closePeerConnection(existingRemoteId);
          }
        }

        for (const remoteId of activeRemoteIds) {
          if (!peerConnections.has(remoteId)) {
            ensurePeerConnection(callId, remoteId);
            if (shouldInitiateOffer(uid, remoteId)) {
              sendOfferToPeer(callId, remoteId);
            }
          }
        }

        emit();
      },
      () => {}
    );

    unsubSignals = onSnapshot(
      query(
        collection(db, 'calls', callId, 'signals'),
        where('callId', '==', callId),
        where('toUid', '==', uid)
      ),
      (snap) => {
        snap.forEach((docSnap) => {
          handleIncomingSignal(callId, docSnap.id, docSnap.data());
        });
      },
      () => {}
    );

    if (withScreen) {
      await startScreenShare(currentUserProfile);
    }

    emit();
    return true;
  }

  async function attachAndActivateScreenStream(screen, currentUserProfile, kind = 'display', toastMsg = 'Live screen share started') {
    if (state.screenStream) stopStreamTracks(state.screenStream);
    state.screenStream = screen;
    state.screenSharing = true;
    state.screenShareKind = kind;

    const videoTrack = screen.getVideoTracks()[0];
    if (videoTrack) {
      videoTrack.onended = () => {
        stopScreenShare(currentUserProfile);
      };
    }

    if (state.activeCall?.id) {
      await updateDoc(doc(db, 'calls', state.activeCall.id), {
        mode: 'screen',
        updatedAt: serverTimestamp(),
      }).catch(() => {});
      await syncPeerDoc(state.activeCall.id, currentUserProfile);
      await renegotiateAllPeers();
    }

    if (toastMsg) toast(toastMsg);
    emit();
    return true;
  }

  async function startScreenShare(currentUserProfile) {
    const support = detectScreenShareSupport();
    if (!support.nativeDisplayMedia || !navigator.mediaDevices?.getDisplayMedia) {
      if (typeof onScreenShareFallback === 'function') {
        onScreenShareFallback({ reason: 'unsupported', support });
      } else {
        toast(support.supportNote);
      }
      return { started: false, fallbackNeeded: true, reason: 'unsupported' };
    }

    const constraintsList = buildDisplayMediaConstraintsList(support.isMobile);
    let lastErr = null;

    for (const constraints of constraintsList) {
      try {
        const screen = await navigator.mediaDevices.getDisplayMedia(constraints);
        await attachAndActivateScreenStream(screen, currentUserProfile, 'display', 'Live screen share started');
        return { started: true, fallbackNeeded: false, kind: 'display' };
      } catch (err) {
        lastErr = err;
        const errName = String(err?.name || '');
        if (errName === 'NotAllowedError' || errName === 'PermissionDeniedError' || errName === 'AbortError') {
          toast('Screen share cancelled or permission denied.');
          return { started: false, fallbackNeeded: false, reason: 'denied' };
        }
        // Retry with softer mobile/video-only constraints for OverconstrainedError / NotSupportedError / TypeError
      }
    }

    if (typeof onScreenShareFallback === 'function') {
      onScreenShareFallback({ reason: 'capture_failed', error: lastErr, support });
    } else {
      toast('System screen capture unavailable on this device. Try Photo/Whiteboard Share.');
    }
    return { started: false, fallbackNeeded: true, reason: 'capture_failed' };
  }

  async function startCanvasScreenShare(canvasEl, currentUserProfile, { fps = 15, kind = 'board', label = 'Live Whiteboard' } = {}) {
    if (!canvasEl) {
      toast('Share canvas surface is unavailable.');
      return { started: false, reason: 'missing_canvas' };
    }
    const captureFn =
      typeof canvasEl.captureStream === 'function'
        ? () => canvasEl.captureStream(fps)
        : typeof canvasEl.mozCaptureStream === 'function'
          ? () => canvasEl.mozCaptureStream(fps)
          : null;

    if (!captureFn) {
      toast('Live canvas streaming is not supported in this browser.');
      return { started: false, reason: 'unsupported' };
    }

    try {
      const stream = captureFn();
      if (!stream || stream.getVideoTracks().length === 0) {
        toast('Could not initialize canvas video track.');
        return { started: false, reason: 'no_track' };
      }
      await attachAndActivateScreenStream(stream, currentUserProfile, kind, `${label} streaming live`);
      return { started: true, kind };
    } catch {
      toast('Could not start live canvas share.');
      return { started: false, reason: 'error' };
    }
  }

  async function stopScreenShare(currentUserProfile) {
    if (!state.screenStream && !state.screenSharing) return;

    const screenTracks = state.screenStream ? state.screenStream.getTracks() : [];
    for (const pc of peerConnections.values()) {
      for (const sender of pc.getSenders()) {
        if (sender.track && screenTracks.includes(sender.track)) {
          try {
            pc.removeTrack(sender);
          } catch {}
        }
      }
    }

    stopStreamTracks(state.screenStream);
    state.screenStream = null;
    state.screenSharing = false;
    state.screenShareKind = '';

    if (state.activeCall?.id) {
      await updateDoc(doc(db, 'calls', state.activeCall.id), {
        mode: state.videoOn ? 'video' : 'audio',
        updatedAt: serverTimestamp(),
      }).catch(() => {});
      await syncPeerDoc(state.activeCall.id, currentUserProfile);
      await renegotiateAllPeers();
    }

    toast('Screen share stopped');
    emit();
  }

  async function toggleCamera(currentUserProfile) {
    if (!state.activeCall) return false;

    if (state.videoOn && state.localStream) {
      state.localStream.getVideoTracks().forEach((t) => {
        t.enabled = false;
        t.stop();
        state.localStream.removeTrack(t);
      });
      for (const pc of peerConnections.values()) {
        for (const sender of pc.getSenders()) {
          if (sender.track && sender.track.kind === 'video' && !state.screenStream?.getTracks().includes(sender.track)) {
            try {
              pc.removeTrack(sender);
            } catch {}
          }
        }
      }
      state.videoOn = false;
      await syncPeerDoc(state.activeCall.id, currentUserProfile);
      await renegotiateAllPeers();
      emit();
      return false;
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      toast('Camera is unavailable in this browser.');
      return false;
    }

    try {
      const camStream = await navigator.mediaDevices.getUserMedia({
        video: buildVideoConstraints(),
        audio: false,
      });
      const camTrack = camStream.getVideoTracks()[0];
      if (!camTrack) return false;

      if (!state.localStream) {
        state.localStream = new MediaStream([camTrack]);
      } else {
        state.localStream.addTrack(camTrack);
      }
      state.camAvailable = true;
      state.videoOn = true;

      await syncPeerDoc(state.activeCall.id, currentUserProfile);
      await renegotiateAllPeers();
      toast(state.cameraFacing === 'environment' ? 'Rear camera enabled' : 'Camera enabled');
      emit();
      return true;
    } catch {
      toast('Camera not detected or permission denied.');
      return false;
    }
  }

  async function switchCameraFacing(currentUserProfile, forcedFacing = '') {
    if (!state.activeCall) {
      toast('Join a call or voice channel first to switch camera.');
      return false;
    }
    const nextFacing =
      forcedFacing === 'user' || forcedFacing === 'environment'
        ? forcedFacing
        : state.cameraFacing === 'environment'
          ? 'user'
          : 'environment';

    state.cameraFacing = nextFacing;
    state.videoInputId = '';

    if (!state.videoOn) {
      return toggleCamera(currentUserProfile);
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      toast('Camera switching is unavailable in this browser.');
      return false;
    }

    try {
      const nextStream = await navigator.mediaDevices.getUserMedia({
        video: buildVideoConstraints(),
        audio: false,
      });
      const nextTrack = nextStream.getVideoTracks()[0];
      if (!nextTrack) return false;

      const oldTracks = state.localStream ? state.localStream.getVideoTracks() : [];
      oldTracks.forEach((old) => {
        state.localStream.removeTrack(old);
        old.stop();
      });

      if (!state.localStream) {
        state.localStream = new MediaStream([nextTrack]);
      } else {
        state.localStream.addTrack(nextTrack);
      }

      for (const pc of peerConnections.values()) {
        const videoSender = pc
          .getSenders()
          .find((s) => s.track && s.track.kind === 'video' && !state.screenStream?.getTracks().includes(s.track));
        if (videoSender) {
          await videoSender.replaceTrack(nextTrack).catch(() => {});
        }
      }

      toast(nextFacing === 'environment' ? 'Switched to rear camera' : 'Switched to front camera');
      emit();
      return true;
    } catch {
      toast('Could not switch camera on this device.');
      return false;
    }
  }

  async function setMuted(nextMuted, currentUserProfile) {
    state.muted = Boolean(nextMuted);
    if (state.localStream) {
      state.localStream.getAudioTracks().forEach((t) => {
        t.enabled = !state.muted;
      });
    }
    if (state.activeCall?.id) {
      await syncPeerDoc(state.activeCall.id, currentUserProfile);
    }
    emit();
  }

  function setDeafened(nextDeafened) {
    state.deafened = Boolean(nextDeafened);
    document.querySelectorAll('[data-rtc-remote-audio], [data-rtc-video]').forEach((el) => {
      if (el instanceof HTMLMediaElement && el.dataset.rtcLocal !== 'true') {
        el.muted = state.deafened;
      }
    });
    emit();
  }

  async function setHandRaised(nextRaised, currentUserProfile) {
    state.handRaised = Boolean(nextRaised);
    if (state.activeCall?.id) {
      await syncPeerDoc(state.activeCall.id, currentUserProfile);
    }
    emit();
  }

  async function declineIncomingCall(callId) {
    stopRingtone();
    if (!callId) return;
    state.incomingCall = null;
    try {
      await updateDoc(doc(db, 'calls', callId), {
        status: 'ended',
        updatedAt: serverTimestamp(),
      });
    } catch {}
    emit();
  }

  async function leaveCall({ skipStatusUpdate = false, skipReview = false } = {}) {
    stopRingtone();
    const prevCall = state.activeCall;
    const prevMode = state.screenSharing ? 'screen' : state.videoOn ? 'video' : prevCall?.mode || 'audio';
    const uid = auth.currentUser?.uid;

    clearCallSubscriptions();
    stopSpeakingLoop();

    for (const remoteId of Array.from(peerConnections.keys())) {
      closePeerConnection(remoteId);
    }

    stopStreamTracks(state.localStream);
    stopStreamTracks(state.screenStream);
    state.localStream = null;
    state.screenStream = null;
    state.activeCall = null;
    state.peers = [];
    state.videoOn = false;
    state.screenSharing = false;
    state.screenShareKind = '';
    state.handRaised = false;
    state.mediaNotice = '';
    handledSignals.clear();

    if (!skipReview && prevCall && (prevCall.allowReview || prevCall.kind === 'dm' || prevCall.kind === 'meeting')) {
      const startedMs = Number(prevCall.startedAtMs || Date.now());
      const endedMs = Date.now();
      state.lastEndedCall = {
        id: prevCall.id,
        sessionId: prevCall.sessionId || '',
        kind: prevCall.kind,
        targetId: prevCall.targetId || '',
        title: prevCall.title || 'Call',
        peerUserId: prevCall.peerUserId || '',
        mode: prevMode,
        startedAtMs: startedMs,
        endedAtMs: endedMs,
        durationSec: Math.max(0, Math.round((endedMs - startedMs) / 1000)),
        endedByRemote: Boolean(skipStatusUpdate),
      };
    }

    if (prevCall?.id && uid) {
      deleteDoc(doc(db, 'calls', prevCall.id, 'peers', uid)).catch(() => {});
      if (!skipStatusUpdate && prevCall.kind === 'dm') {
        updateDoc(doc(db, 'calls', prevCall.id), {
          status: 'ended',
          updatedAt: serverTimestamp(),
        }).catch(() => {});
      }
    }

    emit();
  }

  function clearLastEndedCall() {
    if (!state.lastEndedCall) return;
    state.lastEndedCall = null;
    emit();
  }

  function attachMediaElements(containerEl) {
    if (!containerEl) return;
    const myUid = auth.currentUser?.uid;

    containerEl.querySelectorAll('video[data-rtc-video]').forEach((videoEl) => {
      if (!(videoEl instanceof HTMLVideoElement)) return;
      const targetUid = videoEl.getAttribute('data-rtc-video');
      const streamType = videoEl.getAttribute('data-rtc-stream') || 'auto';

      let targetStream = null;
      if (targetUid === myUid) {
        videoEl.muted = true;
        targetStream = streamType === 'screen' ? state.screenStream : state.screenStream || state.localStream;
      } else {
        videoEl.muted = Boolean(state.deafened);
        targetStream = remoteStreams.get(targetUid) || null;
      }

      if (targetStream && videoEl.srcObject !== targetStream) {
        videoEl.srcObject = targetStream;
        videoEl.play().catch(() => {});
      } else if (!targetStream && videoEl.srcObject) {
        videoEl.srcObject = null;
      }
    });

    containerEl.querySelectorAll('audio[data-rtc-remote-audio]').forEach((audioEl) => {
      if (!(audioEl instanceof HTMLAudioElement)) return;
      const targetUid = audioEl.getAttribute('data-rtc-remote-audio');
      audioEl.muted = Boolean(state.deafened);
      if (state.audioOutputId && typeof audioEl.setSinkId === 'function') {
        audioEl.setSinkId(state.audioOutputId).catch(() => {});
      }
      const stream = targetUid && targetUid !== myUid ? remoteStreams.get(targetUid) || null : null;
      if (stream && audioEl.srcObject !== stream) {
        audioEl.srcObject = stream;
        audioEl.play().catch(() => {});
      }
    });
  }

  return {
    getState: () => ({ ...state, remoteStreams }),
    initGlobalCallListener,
    refreshDevices,
    updateAudioSettings,
    joinCall,
    leaveCall,
    clearLastEndedCall,
    declineIncomingCall,
    startScreenShare,
    startCanvasScreenShare,
    stopScreenShare,
    toggleCamera,
    switchCameraFacing,
    setMuted,
    setDeafened,
    setHandRaised,
    attachMediaElements,
  };
}
