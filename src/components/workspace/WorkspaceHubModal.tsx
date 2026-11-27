import React, { useState, useEffect } from 'react';
import { useNexora } from '../../context/NexoraContext';
import {
  fetchGmailMessages,
  sendGmailEmail,
  fetchGoogleChatSpaces,
  fetchGoogleChatMessages,
  sendGoogleChatMessage,
  fetchGoogleContacts,
  GmailEmail,
  GoogleChatSpace,
  GoogleChatMessage,
  GoogleContact,
} from '../../services/workspace';
import { getStoredOAuthToken } from '../../services/firebase';
import {
  Mail,
  MessageSquare,
  Users,
  Send,
  X,
  RefreshCw,
  Search,
  CheckCircle2,
  Plus,
  ArrowRight,
  Sparkles,
  Inbox,
  ShieldAlert,
} from 'lucide-react';

export const WorkspaceHubModal: React.FC = () => {
  const { activeModal, closeModal, currentUser } = useNexora();

  const [activeTab, setActiveTab] = useState<'gmail' | 'chat' | 'contacts'>('gmail');

  // Gmail State
  const [emails, setEmails] = useState<GmailEmail[]>([]);
  const [selectedEmail, setSelectedEmail] = useState<GmailEmail | null>(null);
  const [isLoadingEmails, setIsLoadingEmails] = useState(false);
  const [showComposeEmail, setShowComposeEmail] = useState(false);
  const [composeTo, setComposeTo] = useState('');
  const [composeSubject, setComposeSubject] = useState('');
  const [composeBody, setComposeBody] = useState('');
  const [isSendingEmail, setIsSendingEmail] = useState(false);
  const [sendSuccessNotice, setSendSuccessNotice] = useState<string | null>(null);

  // Google Chat State
  const [chatSpaces, setChatSpaces] = useState<GoogleChatSpace[]>([]);
  const [selectedSpace, setSelectedSpace] = useState<GoogleChatSpace | null>(null);
  const [chatMessages, setChatMessages] = useState<GoogleChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [isLoadingChat, setIsLoadingChat] = useState(false);
  const [isPostingChat, setIsPostingChat] = useState(false);

  // Google Contacts State
  const [contacts, setContacts] = useState<GoogleContact[]>([]);
  const [contactSearch, setContactSearch] = useState('');
  const [isLoadingContacts, setIsLoadingContacts] = useState(false);

  // Workspace Confirmation Modal for mutating actions (per Google Workspace skill)
  const [pendingConfirmAction, setPendingConfirmAction] = useState<{
    type: 'send_email' | 'send_chat';
    title: string;
    description: string;
    payload: any;
  } | null>(null);

  useEffect(() => {
    if (activeModal === 'workspace') {
      loadWorkspaceData();
    }
  }, [activeModal]);

  const loadWorkspaceData = async () => {
    const token = getStoredOAuthToken() || '';
    
    // Load Gmail
    setIsLoadingEmails(true);
    const fetchedEmails = await fetchGmailMessages(token);
    setEmails(fetchedEmails);
    if (fetchedEmails.length > 0) setSelectedEmail(fetchedEmails[0]);
    setIsLoadingEmails(false);

    // Load Chat Spaces
    setIsLoadingChat(true);
    const spaces = await fetchGoogleChatSpaces(token);
    setChatSpaces(spaces);
    if (spaces.length > 0) {
      setSelectedSpace(spaces[0]);
      const msgs = await fetchGoogleChatMessages(token, spaces[0].name);
      setChatMessages(msgs);
    }
    setIsLoadingChat(false);

    // Load Contacts
    setIsLoadingContacts(true);
    const fetchedContacts = await fetchGoogleContacts(token);
    setContacts(fetchedContacts);
    setIsLoadingContacts(false);
  };

  const handleSelectChatSpace = async (space: GoogleChatSpace) => {
    setSelectedSpace(space);
    setIsLoadingChat(true);
    const token = getStoredOAuthToken() || '';
    const msgs = await fetchGoogleChatMessages(token, space.name);
    setChatMessages(msgs);
    setIsLoadingChat(false);
  };

  // Request Confirmation before executing Gmail Send (Workspace Security Rule)
  const requestSendEmailConfirmation = (e: React.FormEvent) => {
    e.preventDefault();
    if (!composeTo.trim() || !composeSubject.trim() || !composeBody.trim()) return;

    setPendingConfirmAction({
      type: 'send_email',
      title: 'Confirm Email Transmission',
      description: `Are you sure you want to send this email to ${composeTo} via Google Workspace Gmail API?`,
      payload: { to: composeTo, subject: composeSubject, body: composeBody },
    });
  };

  // Request Confirmation before posting to Google Chat
  const requestSendChatConfirmation = (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim() || !selectedSpace) return;

    setPendingConfirmAction({
      type: 'send_chat',
      title: 'Post to Google Chat Space',
      description: `Publish this message to "${selectedSpace.displayName}"?`,
      payload: { spaceName: selectedSpace.name, text: chatInput },
    });
  };

  // Execute confirmed action
  const executeConfirmedAction = async () => {
    if (!pendingConfirmAction) return;
    const token = getStoredOAuthToken() || '';

    if (pendingConfirmAction.type === 'send_email') {
      const { to, subject, body } = pendingConfirmAction.payload;
      setIsSendingEmail(true);
      const res = await sendGmailEmail(token, to, subject, body);
      setIsSendingEmail(false);

      if (res.success) {
        setSendSuccessNotice(`Email successfully sent to ${to}!`);
        setShowComposeEmail(false);
        setComposeTo('');
        setComposeSubject('');
        setComposeBody('');
        setTimeout(() => setSendSuccessNotice(null), 4000);
      } else {
        alert(res.error || 'Failed to send email.');
      }
    } else if (pendingConfirmAction.type === 'send_chat') {
      const { spaceName, text } = pendingConfirmAction.payload;
      setIsPostingChat(true);
      const res = await sendGoogleChatMessage(token, spaceName, text);
      setIsPostingChat(false);

      if (res.success) {
        setChatInput('');
        setChatMessages(prev => [
          ...prev,
          {
            name: `local-${Date.now()}`,
            senderName: currentUser.displayName,
            senderAvatar: currentUser.avatar,
            text,
            createTime: 'Just now',
          },
        ]);
      } else {
        alert(res.error || 'Failed to send Google Chat message.');
      }
    }

    setPendingConfirmAction(null);
  };

  if (activeModal !== 'workspace') return null;

  const filteredContacts = contacts.filter(
    c =>
      c.displayName.toLowerCase().includes(contactSearch.toLowerCase()) ||
      c.email.toLowerCase().includes(contactSearch.toLowerCase())
  );

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-50 flex items-center justify-center p-4">
      <div className="bg-[#15171E] border border-[#262A36] rounded-3xl w-full max-w-5xl h-[85vh] flex flex-col overflow-hidden shadow-2xl relative">
        {/* Top Header */}
        <div className="h-16 px-6 border-b border-[#262A36] bg-[#111318] flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#7667F7]/20 border border-[#7667F7]/40 flex items-center justify-center text-[#7667F7]">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white flex items-center gap-2">
                Google Workspace Hub
                <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-[#35C98B]/20 text-[#35C98B] border border-[#35C98B]/30">
                  OAuth Synced
                </span>
              </h2>
              <p className="text-xs text-[#9B9EAC]">
                Gmail Inbox • Google Chat Spaces • People Contacts
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={loadWorkspaceData}
              className="p-2 text-[#9B9EAC] hover:text-white rounded-xl bg-[#191C24] border border-[#262A36]"
              title="Refresh Sync"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
            <button
              onClick={closeModal}
              className="p-2 text-[#9B9EAC] hover:text-white rounded-xl bg-[#191C24] border border-[#262A36]"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="px-6 pt-3 bg-[#111318] border-b border-[#262A36] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setActiveTab('gmail')}
              className={`px-4 py-2.5 text-xs font-bold rounded-t-xl transition-all flex items-center gap-2 ${
                activeTab === 'gmail'
                  ? 'bg-[#15171E] text-white border-t-2 border-[#7667F7]'
                  : 'text-[#9B9EAC] hover:text-white'
              }`}
            >
              <Mail className="w-4 h-4 text-[#EA4335]" />
              <span>Gmail Inbox ({emails.length})</span>
            </button>

            <button
              onClick={() => setActiveTab('chat')}
              className={`px-4 py-2.5 text-xs font-bold rounded-t-xl transition-all flex items-center gap-2 ${
                activeTab === 'chat'
                  ? 'bg-[#15171E] text-white border-t-2 border-[#7667F7]'
                  : 'text-[#9B9EAC] hover:text-white'
              }`}
            >
              <MessageSquare className="w-4 h-4 text-[#4285F4]" />
              <span>Google Chat ({chatSpaces.length})</span>
            </button>

            <button
              onClick={() => setActiveTab('contacts')}
              className={`px-4 py-2.5 text-xs font-bold rounded-t-xl transition-all flex items-center gap-2 ${
                activeTab === 'contacts'
                  ? 'bg-[#15171E] text-white border-t-2 border-[#7667F7]'
                  : 'text-[#9B9EAC] hover:text-white'
              }`}
            >
              <Users className="w-4 h-4 text-[#34A853]" />
              <span>Contacts Directory ({contacts.length})</span>
            </button>
          </div>

          {sendSuccessNotice && (
            <div className="px-3 py-1 bg-[#35C98B]/20 border border-[#35C98B]/40 text-[#35C98B] text-xs font-semibold rounded-lg flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4" />
              <span>{sendSuccessNotice}</span>
            </div>
          )}
        </div>

        {/* Main Tab Content */}
        <div className="flex-1 overflow-hidden bg-[#15171E]">
          {/* TAB 1: GMAIL */}
          {activeTab === 'gmail' && (
            <div className="h-full flex overflow-hidden">
              {/* Email List Sidebar */}
              <div className="w-80 border-r border-[#262A36] bg-[#111318] flex flex-col h-full">
                <div className="p-3 border-b border-[#262A36]">
                  <button
                    onClick={() => setShowComposeEmail(true)}
                    className="w-full py-2.5 bg-[#7667F7] hover:bg-[#6353f4] text-white text-xs font-bold rounded-xl flex items-center justify-center gap-2 shadow-lg"
                  >
                    <Plus className="w-4 h-4" />
                    <span>Compose Email</span>
                  </button>
                </div>

                <div className="flex-1 overflow-y-auto divide-y divide-[#262A36]/50">
                  {isLoadingEmails ? (
                    <div className="p-8 text-center text-xs text-[#9B9EAC] flex flex-col items-center gap-2">
                      <RefreshCw className="w-5 h-5 animate-spin text-[#7667F7]" />
                      <span>Fetching Gmail Inbox...</span>
                    </div>
                  ) : emails.length === 0 ? (
                    <div className="p-8 text-center text-xs text-[#9B9EAC]">
                      No messages found in Gmail inbox.
                    </div>
                  ) : (
                    emails.map(email => (
                      <button
                        key={email.id}
                        onClick={() => {
                          setSelectedEmail(email);
                          setShowComposeEmail(false);
                        }}
                        className={`w-full p-3.5 text-left transition-colors flex flex-col gap-1 ${
                          selectedEmail?.id === email.id
                            ? 'bg-[#1E222D] border-l-4 border-[#7667F7]'
                            : 'hover:bg-[#181B24]'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-bold text-white truncate max-w-[170px]">
                            {email.sender}
                          </span>
                          <span className="text-[10px] text-[#9B9EAC]">
                            {email.date}
                          </span>
                        </div>
                        <h4 className="text-xs font-semibold text-[#d8dbe6] truncate">
                          {email.subject}
                        </h4>
                        <p className="text-[11px] text-[#717585] line-clamp-2">
                          {email.snippet}
                        </p>
                      </button>
                    ))
                  )}
                </div>
              </div>

              {/* Email Detail / Compose View */}
              <div className="flex-1 flex flex-col h-full overflow-y-auto bg-[#15171E] p-6">
                {showComposeEmail ? (
                  <form onSubmit={requestSendEmailConfirmation} className="space-y-4 max-w-2xl">
                    <h3 className="text-sm font-bold text-white flex items-center gap-2">
                      <Mail className="w-4 h-4 text-[#EA4335]" />
                      New Message (Google Workspace Gmail API)
                    </h3>

                    <div>
                      <label className="block text-xs font-semibold text-[#9B9EAC] mb-1">
                        To Email
                      </label>
                      <input
                        type="email"
                        required
                        value={composeTo}
                        onChange={e => setComposeTo(e.target.value)}
                        placeholder="recipient@example.com"
                        className="w-full px-3.5 py-2.5 rounded-xl bg-[#111318] border border-[#262A36] text-white text-xs focus:outline-none focus:border-[#7667F7]"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-[#9B9EAC] mb-1">
                        Subject
                      </label>
                      <input
                        type="text"
                        required
                        value={composeSubject}
                        onChange={e => setComposeSubject(e.target.value)}
                        placeholder="NEXORA Community Sync"
                        className="w-full px-3.5 py-2.5 rounded-xl bg-[#111318] border border-[#262A36] text-white text-xs focus:outline-none focus:border-[#7667F7]"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-[#9B9EAC] mb-1">
                        Message Body
                      </label>
                      <textarea
                        rows={8}
                        required
                        value={composeBody}
                        onChange={e => setComposeBody(e.target.value)}
                        placeholder="Type your email content here..."
                        className="w-full p-3.5 rounded-xl bg-[#111318] border border-[#262A36] text-white text-xs focus:outline-none focus:border-[#7667F7] resize-none"
                      />
                    </div>

                    <div className="flex justify-end gap-3 pt-2">
                      <button
                        type="button"
                        onClick={() => setShowComposeEmail(false)}
                        className="px-4 py-2 bg-[#191C24] hover:bg-[#20242f] text-[#9B9EAC] text-xs font-semibold rounded-xl"
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        disabled={isSendingEmail}
                        className="px-5 py-2 bg-[#7667F7] hover:bg-[#6353f4] text-white text-xs font-bold rounded-xl flex items-center gap-2 shadow-lg"
                      >
                        <Send className="w-4 h-4" />
                        <span>Send Email</span>
                      </button>
                    </div>
                  </form>
                ) : selectedEmail ? (
                  <div className="space-y-6 max-w-3xl">
                    <div className="border-b border-[#262A36] pb-4 space-y-2">
                      <h2 className="text-base font-extrabold text-white">
                        {selectedEmail.subject}
                      </h2>
                      <div className="flex items-center justify-between text-xs text-[#9B9EAC]">
                        <span className="font-semibold text-[#35C98B]">
                          From: {selectedEmail.sender}
                        </span>
                        <span>{selectedEmail.date}</span>
                      </div>
                    </div>

                    <div className="p-6 rounded-2xl bg-[#111318] border border-[#262A36] text-xs text-[#d8dbe6] leading-relaxed whitespace-pre-wrap font-sans">
                      {selectedEmail.snippet}
                      {'\n\n'}
                      --
                      {'\n'}
                      Sent via NEXORA Google Workspace Integration Hub
                    </div>

                    <div className="flex gap-3">
                      <button
                        onClick={() => {
                          setComposeTo(selectedEmail.sender);
                          setComposeSubject(`Re: ${selectedEmail.subject}`);
                          setShowComposeEmail(true);
                        }}
                        className="px-4 py-2 rounded-xl bg-[#191C24] hover:bg-[#20242f] border border-[#262A36] text-white text-xs font-semibold flex items-center gap-2"
                      >
                        <Send className="w-3.5 h-3.5 text-[#7667F7]" />
                        <span>Reply in Gmail</span>
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex-1 flex flex-col items-center justify-center text-[#9B9EAC] gap-2">
                    <Inbox className="w-10 h-10 opacity-40" />
                    <p className="text-xs">Select an email to read details</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB 2: GOOGLE CHAT */}
          {activeTab === 'chat' && (
            <div className="h-full flex overflow-hidden">
              {/* Chat Spaces Sidebar */}
              <div className="w-72 border-r border-[#262A36] bg-[#111318] flex flex-col h-full">
                <div className="p-3 border-b border-[#262A36] text-xs font-bold text-[#9B9EAC] uppercase tracking-wider">
                  Google Chat Spaces
                </div>
                <div className="flex-1 overflow-y-auto divide-y divide-[#262A36]/40">
                  {chatSpaces.map(space => (
                    <button
                      key={space.name}
                      onClick={() => handleSelectChatSpace(space)}
                      className={`w-full p-3.5 text-left flex items-center gap-3 transition-colors ${
                        selectedSpace?.name === space.name
                          ? 'bg-[#1E222D] border-l-4 border-[#4285F4]'
                          : 'hover:bg-[#181B24]'
                      }`}
                    >
                      <div className="w-9 h-9 rounded-xl bg-[#4285F4]/20 text-[#4285F4] flex items-center justify-center font-bold text-xs">
                        💬
                      </div>
                      <div className="flex-1 min-w-0">
                        <h4 className="text-xs font-bold text-white truncate">
                          {space.displayName}
                        </h4>
                        <span className="text-[10px] text-[#9B9EAC]">
                          {space.type} • {space.memberCount || 1} members
                        </span>
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Chat Messages Panel */}
              <div className="flex-1 flex flex-col h-full bg-[#15171E]">
                {selectedSpace ? (
                  <>
                    <div className="h-12 px-6 border-b border-[#262A36] bg-[#111318] flex items-center justify-between">
                      <h3 className="text-xs font-bold text-white flex items-center gap-2">
                        <MessageSquare className="w-4 h-4 text-[#4285F4]" />
                        {selectedSpace.displayName}
                      </h3>
                      <span className="text-[10px] font-mono text-[#9B9EAC]">
                        {selectedSpace.name}
                      </span>
                    </div>

                    <div className="flex-1 overflow-y-auto p-6 space-y-4">
                      {isLoadingChat ? (
                        <div className="text-center py-8 text-xs text-[#9B9EAC]">
                          Loading Chat Messages...
                        </div>
                      ) : chatMessages.length === 0 ? (
                        <div className="text-center py-8 text-xs text-[#9B9EAC]">
                          No messages in this Google Chat Space.
                        </div>
                      ) : (
                        chatMessages.map((msg, i) => (
                          <div key={i} className="flex gap-3">
                            <div className="w-8 h-8 rounded-full bg-[#7667F7] text-white font-bold text-xs flex items-center justify-center">
                              {msg.senderName[0]?.toUpperCase() || 'U'}
                            </div>
                            <div>
                              <div className="flex items-center gap-2">
                                <span className="text-xs font-bold text-white">
                                  {msg.senderName}
                                </span>
                                <span className="text-[10px] text-[#717585]">
                                  {msg.createTime}
                                </span>
                              </div>
                              <p className="text-xs text-[#d8dbe6] mt-1 bg-[#191C24] p-2.5 rounded-xl border border-[#262A36] inline-block max-w-xl">
                                {msg.text}
                              </p>
                            </div>
                          </div>
                        ))
                      )}
                    </div>

                    <form onSubmit={requestSendChatConfirmation} className="p-4 border-t border-[#262A36] bg-[#111318] flex gap-2">
                      <input
                        type="text"
                        value={chatInput}
                        onChange={e => setChatInput(e.target.value)}
                        placeholder={`Message ${selectedSpace.displayName}...`}
                        className="flex-1 px-4 py-2.5 rounded-xl bg-[#191C24] border border-[#262A36] text-white text-xs focus:outline-none focus:border-[#4285F4]"
                      />
                      <button
                        type="submit"
                        disabled={isPostingChat || !chatInput.trim()}
                        className="px-4 py-2.5 bg-[#4285F4] hover:bg-[#3367d6] text-white font-bold text-xs rounded-xl flex items-center gap-1.5"
                      >
                        <Send className="w-4 h-4" />
                        <span>Post</span>
                      </button>
                    </form>
                  </>
                ) : (
                  <div className="flex-1 flex items-center justify-center text-xs text-[#9B9EAC]">
                    Select a Google Chat Space
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB 3: CONTACTS */}
          {activeTab === 'contacts' && (
            <div className="h-full flex flex-col p-6 space-y-4 overflow-hidden">
              <div className="flex items-center justify-between gap-4">
                <div className="relative flex-1 max-w-md">
                  <Search className="w-4 h-4 text-[#9B9EAC] absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={contactSearch}
                    onChange={e => setContactSearch(e.target.value)}
                    placeholder="Search Google Contacts by name or email..."
                    className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-[#111318] border border-[#262A36] text-white text-xs focus:outline-none focus:border-[#34A853]"
                  />
                </div>
                <span className="text-xs text-[#9B9EAC] font-medium">
                  Showing {filteredContacts.length} contacts
                </span>
              </div>

              <div className="flex-1 overflow-y-auto grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {isLoadingContacts ? (
                  <div className="col-span-full py-12 text-center text-xs text-[#9B9EAC]">
                    Loading Google Contacts...
                  </div>
                ) : filteredContacts.length === 0 ? (
                  <div className="col-span-full py-12 text-center text-xs text-[#9B9EAC]">
                    No contacts found.
                  </div>
                ) : (
                  filteredContacts.map(c => (
                    <div
                      key={c.resourceName}
                      className="p-4 rounded-2xl bg-[#111318] border border-[#262A36] hover:border-[#34A853]/50 transition-colors flex items-center gap-3"
                    >
                      <img
                        src={c.photoUrl}
                        alt={c.displayName}
                        className="w-12 h-12 rounded-2xl object-cover border border-[#262A36]"
                      />
                      <div className="flex-1 min-w-0 space-y-1">
                        <h4 className="text-xs font-bold text-white truncate">
                          {c.displayName}
                        </h4>
                        <p className="text-[11px] text-[#9B9EAC] truncate">
                          {c.email}
                        </p>
                        {c.phone && (
                          <p className="text-[10px] text-[#717585] truncate">
                            {c.phone}
                          </p>
                        )}
                        <div className="pt-1 flex gap-2">
                          <button
                            onClick={() => {
                              setActiveTab('gmail');
                              setComposeTo(c.email);
                              setComposeSubject('Greeting from NEXORA');
                              setShowComposeEmail(true);
                            }}
                            className="px-2.5 py-1 rounded-lg bg-[#34A853]/20 hover:bg-[#34A853]/30 text-[#34A853] text-[10px] font-bold flex items-center gap-1"
                          >
                            <Mail className="w-3 h-3" />
                            <span>Email</span>
                          </button>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>

        {/* Confirmation Modal Overlay for Workspace Mutating Actions */}
        {pendingConfirmAction && (
          <div className="absolute inset-0 bg-black/85 backdrop-blur-md z-50 flex items-center justify-center p-6">
            <div className="bg-[#181B24] border border-[#7667F7]/40 rounded-3xl p-6 max-w-md w-full space-y-4 shadow-2xl animate-scaleIn">
              <div className="w-12 h-12 rounded-2xl bg-[#7667F7]/20 border border-[#7667F7]/50 text-[#7667F7] flex items-center justify-center">
                <ShieldAlert className="w-6 h-6" />
              </div>

              <div>
                <h3 className="text-base font-bold text-white">
                  {pendingConfirmAction.title}
                </h3>
                <p className="text-xs text-[#9B9EAC] mt-1 leading-relaxed">
                  {pendingConfirmAction.description}
                </p>
              </div>

              <div className="p-3.5 rounded-xl bg-[#111318] border border-[#262A36] text-[11px] font-mono text-[#35C98B]">
                Workspace Scope: Google Cloud OAuth Client Enabled
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setPendingConfirmAction(null)}
                  className="flex-1 py-2.5 bg-[#191C24] hover:bg-[#20242f] text-[#9B9EAC] hover:text-white text-xs font-semibold rounded-xl"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={executeConfirmedAction}
                  className="flex-1 py-2.5 bg-[#7667F7] hover:bg-[#6353f4] text-white text-xs font-bold rounded-xl shadow-lg flex items-center justify-center gap-1.5"
                >
                  <span>Authorize & Transmit</span>
                  <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
