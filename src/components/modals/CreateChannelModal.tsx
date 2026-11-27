import React, { useState } from 'react';
import { useNexora } from '../../context/NexoraContext';
import {
  X,
  Hash,
  Volume2,
  Megaphone,
  MessageSquareText,
  Radio,
  Lock,
} from 'lucide-react';
import { ChannelType } from '../../types';
import { sanitizeChannelName } from '../../utils/rules';

export const CreateChannelModal: React.FC = () => {
  const { activeModal, closeModal, activeServer, createChannel } = useNexora();

  const [channelType, setChannelType] = useState<ChannelType>('text');
  const [channelName, setChannelName] = useState('');
  const [topic, setTopic] = useState('');
  const [isPrivate, setIsPrivate] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (activeModal !== 'create-channel' || !activeServer) return null;

  const channelTypes: { type: ChannelType; name: string; desc: string; icon: any }[] = [
    {
      type: 'text',
      name: 'Text Channel',
      desc: 'Post images, memes, code, and banter',
      icon: <Hash className="w-5 h-5 text-[#7667F7]" />,
    },
    {
      type: 'voice',
      name: 'Voice Channel',
      desc: 'Hang out with voice, video, and screen sharing',
      icon: <Volume2 className="w-5 h-5 text-[#35C98B]" />,
    },
    {
      type: 'announcement',
      name: 'Announcement',
      desc: 'Important server notices and updates',
      icon: <Megaphone className="w-5 h-5 text-[#F59E0B]" />,
    },
    {
      type: 'forum',
      name: 'Forum Channel',
      desc: 'Organized discussions with post topics and tags',
      icon: <MessageSquareText className="w-5 h-5 text-[#EC4899]" />,
    },
    {
      type: 'stage',
      name: 'Stage Channel',
      desc: 'Live keynotes with speakers and audience',
      icon: <Radio className="w-5 h-5 text-[#EF4444]" />,
    },
  ];

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const sanitized = sanitizeChannelName(channelName);
    if (!sanitized.valid) {
      setError(sanitized.error || 'Invalid channel name.');
      return;
    }

    createChannel(activeServer.id, sanitized.formatted, channelType, undefined, topic);
    closeModal();
    setChannelName('');
    setTopic('');
    setError(null);
  };

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-[#191C24] border border-[#2b303d] rounded-3xl w-full max-w-md p-6 shadow-2xl relative select-none">
        <div className="flex items-center justify-between pb-3 border-b border-[#262A36]">
          <h2 className="text-base font-extrabold text-white">Create Channel</h2>
          <button
            onClick={closeModal}
            className="p-1 text-[#9B9EAC] hover:text-white rounded-lg"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 pt-4">
          {/* Channel Type Selector */}
          <div>
            <label className="block text-[11px] font-extrabold text-[#717585] uppercase tracking-wider mb-2">
              CHANNEL TYPE
            </label>
            <div className="space-y-1.5 max-h-56 overflow-y-auto pr-1">
              {channelTypes.map(item => (
                <button
                  key={item.type}
                  type="button"
                  onClick={() => setChannelType(item.type)}
                  className={`w-full flex items-center gap-3 p-3 rounded-2xl border text-left transition-all ${
                    channelType === item.type
                      ? 'bg-[#111318] border-[#7667F7] ring-1 ring-[#7667F7]'
                      : 'bg-[#111318] border-[#262A36] hover:bg-[#15171e]'
                  }`}
                >
                  <div className="p-2 rounded-xl bg-[#191C24]">{item.icon}</div>
                  <div className="flex-1">
                    <p className="text-xs font-bold text-white">{item.name}</p>
                    <p className="text-[10px] text-[#9B9EAC]">{item.desc}</p>
                  </div>
                  <div
                    className={`w-4 h-4 rounded-full border flex items-center justify-center ${
                      channelType === item.type
                        ? 'border-[#7667F7] bg-[#7667F7]'
                        : 'border-[#717585]'
                    }`}
                  >
                    {channelType === item.type && (
                      <span className="w-1.5 h-1.5 rounded-full bg-white" />
                    )}
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Channel Name Input */}
          <div>
            <label className="block text-[11px] font-extrabold text-[#717585] uppercase tracking-wider mb-1">
              CHANNEL NAME
            </label>
            <div className="relative flex items-center">
              <span className="absolute left-3 text-sm text-[#9B9EAC]">
                {channelType === 'voice' ? '🔊' : '#'}
              </span>
              <input
                type="text"
                required
                placeholder="new-channel"
                value={channelName}
                onChange={e => {
                  setChannelName(e.target.value);
                  setError(null);
                }}
                className="w-full bg-[#111318] border border-[#262A36] focus:border-[#7667F7] rounded-xl px-3 pl-8 py-2 text-xs text-white focus:outline-none"
              />
            </div>
            {error && <p className="text-[11px] text-[#EF4444] mt-1">{error}</p>}
          </div>

          {/* Topic */}
          <div>
            <label className="block text-[11px] font-extrabold text-[#717585] uppercase tracking-wider mb-1">
              TOPIC (OPTIONAL)
            </label>
            <input
              type="text"
              placeholder="What is this channel about?"
              value={topic}
              onChange={e => setTopic(e.target.value)}
              className="w-full bg-[#111318] border border-[#262A36] focus:border-[#7667F7] rounded-xl px-3 py-2 text-xs text-white focus:outline-none"
            />
          </div>

          {/* Private Channel Toggle */}
          <div className="flex items-center justify-between p-3 rounded-2xl bg-[#111318] border border-[#262A36]">
            <div className="flex items-center gap-2">
              <Lock className="w-4 h-4 text-[#9B9EAC]" />
              <div>
                <p className="text-xs font-bold text-white">Private Channel</p>
                <p className="text-[10px] text-[#9B9EAC]">
                  Only selected members and roles will be able to view this channel.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setIsPrivate(!isPrivate)}
              className={`w-10 h-5 rounded-full transition-colors relative p-0.5 ${
                isPrivate ? 'bg-[#7667F7]' : 'bg-[#373c4d]'
              }`}
            >
              <span
                className={`w-4 h-4 rounded-full bg-white block transition-transform ${
                  isPrivate ? 'translate-x-5' : 'translate-x-0'
                }`}
              />
            </button>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={closeModal}
              className="px-4 py-2 bg-[#252936] text-xs font-semibold text-[#9B9EAC] rounded-xl hover:text-white"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-5 py-2 bg-[#7667F7] hover:bg-[#6353f4] text-xs font-bold text-white rounded-xl shadow-lg shadow-[#7667F7]/30 transition-all"
            >
              Create Channel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
