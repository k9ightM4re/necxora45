import { useEffect } from 'react';
import { create } from 'zustand';
import type { InboxSnapshot, NexoraAppBridge } from './types';

const EMPTY_SNAPSHOT: InboxSnapshot = {
  currentUser: {
    id: '',
    displayName: 'Member',
    username: 'member',
    initials: 'MB',
    avatar: '',
    status: 'offline',
  },
  dms: [],
  dmMessages: {},
  directoryUsers: [],
  connectionRequests: [],
  blockedIds: [],
  acceptedPeerIds: [],
  activeDmId: '',
  pendingPeerId: '',
  dmSearchQuery: '',
  dmInboxTab: 'all',
  showArchivedDms: false,
  dmThreadActiveMobile: false,
  dmMessagesLoadingThreadId: '',
  dmError: '',
  isSendingMessage: false,
  replyToMsgId: null,
  onlineUids: [],
  wsConnected: false,
};

interface InboxStoreState {
  snapshot: InboxSnapshot;
  bridgeReady: boolean;
  setSnapshot: (snapshot: InboxSnapshot) => void;
  setBridgeReady: (ready: boolean) => void;
}

export const useInboxStore = create<InboxStoreState>((set) => ({
  snapshot: EMPTY_SNAPSHOT,
  bridgeReady: false,
  setSnapshot: (snapshot) => set({ snapshot }),
  setBridgeReady: (bridgeReady) => set({ bridgeReady }),
}));

export function useNexoraBridge(): {
  snapshot: InboxSnapshot;
  bridge: NexoraAppBridge | undefined;
  bridgeReady: boolean;
} {
  const snapshot = useInboxStore((s) => s.snapshot);
  const bridgeReady = useInboxStore((s) => s.bridgeReady);
  const setSnapshot = useInboxStore((s) => s.setSnapshot);
  const setBridgeReady = useInboxStore((s) => s.setBridgeReady);

  useEffect(() => {
    let unsub: (() => void) | null = null;

    const attach = () => {
      const b = window.NEXORA_APP_BRIDGE;
      if (!b) return false;
      setBridgeReady(true);
      setSnapshot(b.getSnapshot());
      unsub = b.subscribe((next) => {
        setSnapshot(next);
      });
      return true;
    };

    if (!attach()) {
      const onReady = () => {
        attach();
      };
      window.addEventListener('nexora:bridge-ready', onReady);
      return () => {
        window.removeEventListener('nexora:bridge-ready', onReady);
        if (unsub) unsub();
      };
    }

    return () => {
      if (unsub) unsub();
    };
  }, [setBridgeReady, setSnapshot]);

  return {
    snapshot,
    bridge: typeof window !== 'undefined' ? window.NEXORA_APP_BRIDGE : undefined,
    bridgeReady,
  };
}
