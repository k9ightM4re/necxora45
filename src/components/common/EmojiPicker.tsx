import React, { useState, useEffect, useRef } from 'react';
import { Search, X, Smile, Flame, Sparkles, Heart, Rocket, Coffee } from 'lucide-react';

export interface EmojiCategory {
  id: string;
  name: string;
  icon: string;
  emojis: { emoji: string; name: string }[];
}

export const DEFAULT_EMOJI_CATEGORIES: EmojiCategory[] = [
  {
    id: 'frequent',
    name: 'Popular & Frequently Used',
    icon: '🔥',
    emojis: [
      { emoji: '👍', name: 'thumbs up' },
      { emoji: '❤️', name: 'red heart' },
      { emoji: '🔥', name: 'fire flame' },
      { emoji: '🚀', name: 'rocket ship' },
      { emoji: '🎉', name: 'party popper celebration' },
      { emoji: '😂', name: 'joy laughing tears' },
      { emoji: '👀', name: 'eyes peek' },
      { emoji: '💯', name: 'hundred points score' },
      { emoji: '✨', name: 'sparkles magic' },
      { emoji: '⚡', name: 'zap lightning' },
      { emoji: '☕', name: 'coffee tea' },
      { emoji: '🎮', name: 'video game controller' },
    ],
  },
  {
    id: 'smileys',
    name: 'Smileys & Emotion',
    icon: '😀',
    emojis: [
      { emoji: '😀', name: 'grinning face' },
      { emoji: '😃', name: 'smiley happy' },
      { emoji: '😄', name: 'smile grin' },
      { emoji: '😁', name: 'beaming face' },
      { emoji: '😆', name: 'laughing squint' },
      { emoji: '😅', name: 'sweat smile' },
      { emoji: '🤣', name: 'rofl laughing' },
      { emoji: '😊', name: 'blush happy' },
      { emoji: '😇', name: 'halo angel' },
      { emoji: '🥰', name: 'hearts face' },
      { emoji: '😍', name: 'heart eyes' },
      { emoji: '🤩', name: 'star struck' },
      { emoji: '😘', name: 'kissing heart' },
      { emoji: '😜', name: 'winking tongue' },
      { emoji: '🤪', name: 'zany face' },
      { emoji: '😎', name: 'sunglasses cool' },
      { emoji: '🤓', name: 'nerd glasses' },
      { emoji: '🥳', name: 'party face' },
      { emoji: '🤔', name: 'thinking face' },
      { emoji: '🤖', name: 'robot bot' },
      { emoji: '🤗', name: 'hugging face' },
      { emoji: '😴', name: 'sleeping face' },
      { emoji: '😷', name: 'mask health' },
      { emoji: '😈', name: 'smiling imp devil' },
    ],
  },
  {
    id: 'gestures',
    name: 'Hands & Gestures',
    icon: '👋',
    emojis: [
      { emoji: '👋', name: 'waving hand hi' },
      { emoji: '🙌', name: 'raised hands celebrate' },
      { emoji: '👏', name: 'clapping hands applause' },
      { emoji: '🤝', name: 'handshake agree' },
      { emoji: '🙏', name: 'folded hands pray thank' },
      { emoji: '✌️', name: 'victory v sign peace' },
      { emoji: '🤞', name: 'crossed fingers luck' },
      { emoji: '🤟', name: 'love sign' },
      { emoji: '🤘', name: 'rock on horns' },
      { emoji: '🤙', name: 'call me hand' },
      { emoji: '💪', name: 'flexed biceps flex strong' },
      { emoji: '👊', name: 'fist bump' },
    ],
  },
  {
    id: 'nature',
    name: 'Animals & Nature',
    icon: '🐶',
    emojis: [
      { emoji: '🐶', name: 'dog puppy' },
      { emoji: '🐱', name: 'cat kitty' },
      { emoji: '🦁', name: 'lion king' },
      { emoji: '🐯', name: 'tiger' },
      { emoji: '🦊', name: 'fox' },
      { emoji: '🐼', name: 'panda' },
      { emoji: '🦄', name: 'unicorn magic' },
      { emoji: '🐲', name: 'dragon' },
      { emoji: '🌴', name: 'palm tree' },
      { emoji: '🍀', name: 'four leaf clover' },
      { emoji: '🌸', name: 'cherry blossom flower' },
      { emoji: '⭐', name: 'glowing star' },
    ],
  },
  {
    id: 'activities',
    name: 'Activities & Symbols',
    icon: '🎮',
    emojis: [
      { emoji: '🎮', name: 'video game controller' },
      { emoji: '⚽', name: 'soccer ball' },
      { emoji: '🏀', name: 'basketball' },
      { emoji: '🏆', name: 'trophy winner gold' },
      { emoji: '🎯', name: 'bullseye target' },
      { emoji: '🎨', name: 'artist palette design' },
      { emoji: '🎬', name: 'clapper board cinema' },
      { emoji: '🎤', name: 'microphone stage singing' },
      { emoji: '🎧', name: 'headphones audio music' },
      { emoji: '💻', name: 'laptop computer code dev' },
      { emoji: '📱', name: 'mobile phone text' },
      { emoji: '💡', name: 'light bulb idea' },
    ],
  },
];

export interface EmojiPickerProps {
  onSelectEmoji: (emoji: string) => void;
  onClose: () => void;
  categories?: EmojiCategory[];
  title?: string;
  autoFocus?: boolean;
}

export const EmojiPicker: React.FC<EmojiPickerProps> = ({
  onSelectEmoji,
  onClose,
  categories = DEFAULT_EMOJI_CATEGORIES,
  title = 'Emoji Picker',
  autoFocus = true,
}) => {
  const [search, setSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState<string>('frequent');
  const containerRef = useRef<HTMLDivElement>(null);

  // Close when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [onClose]);

  // Close on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const query = search.trim().toLowerCase();

  const filteredEmojis = query
    ? categories
        .flatMap(cat => cat.emojis)
        .filter(
          item =>
            item.name.toLowerCase().includes(query) ||
            item.emoji.includes(query)
        )
    : [];

  return (
    <div
      ref={containerRef}
      className="absolute right-0 bottom-12 w-80 bg-[#181B24] border border-[#2b303e] rounded-2xl shadow-2xl z-50 flex flex-col overflow-hidden animate-fadeIn select-none"
      role="dialog"
      aria-label={title}
    >
      {/* Header & Search Bar */}
      <div className="p-3 border-b border-[#262A36] bg-[#111318] space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-xs font-bold text-white flex items-center gap-1.5">
            <Smile className="w-4 h-4 text-[#F59E0B]" />
            {title}
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close Emoji Picker"
            className="p-1 text-[#9B9EAC] hover:text-white rounded-lg hover:bg-[#1f232f] transition-colors"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="relative">
          <Search className="w-3.5 h-3.5 text-[#9B9EAC] absolute left-2.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            autoFocus={autoFocus}
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search emoji (e.g. fire, smile, heart)..."
            className="w-full pl-8 pr-3 py-1.5 rounded-xl bg-[#191C24] border border-[#262A36] text-white text-xs focus:outline-none focus:border-[#7667F7]"
          />
        </div>
      </div>

      {/* Category Tabs (When not searching) */}
      {!query && (
        <div className="flex items-center justify-around px-2 py-1.5 bg-[#111318] border-b border-[#262A36]">
          {categories.map(cat => (
            <button
              key={cat.id}
              type="button"
              onClick={() => setActiveCategory(cat.id)}
              className={`p-1.5 rounded-lg text-sm transition-all ${
                activeCategory === cat.id
                  ? 'bg-[#7667F7]/20 border border-[#7667F7]/40 scale-110'
                  : 'hover:bg-[#191C24]'
              }`}
              title={cat.name}
            >
              {cat.icon}
            </button>
          ))}
        </div>
      )}

      {/* Emoji Grid Area */}
      <div className="p-3 h-64 overflow-y-auto space-y-3">
        {query ? (
          <div>
            <div className="text-[10px] font-bold text-[#9B9EAC] uppercase tracking-wider mb-2">
              Results ({filteredEmojis.length})
            </div>
            {filteredEmojis.length === 0 ? (
              <div className="text-center py-8 text-xs text-[#9B9EAC]">
                No emojis match "{search}"
              </div>
            ) : (
              <div className="grid grid-cols-6 gap-1">
                {filteredEmojis.map((item, idx) => (
                  <button
                    key={`${item.emoji}-${idx}`}
                    type="button"
                    onClick={() => onSelectEmoji(item.emoji)}
                    className="aspect-square flex items-center justify-center text-xl hover:bg-[#252936] hover:scale-125 rounded-xl transition-all"
                    title={item.name}
                  >
                    {item.emoji}
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          categories
            .filter(cat => cat.id === activeCategory)
            .map(cat => (
              <div key={cat.id}>
                <div className="text-[10px] font-bold text-[#9B9EAC] uppercase tracking-wider mb-2">
                  {cat.name}
                </div>
                <div className="grid grid-cols-6 gap-1">
                  {cat.emojis.map((item, idx) => (
                    <button
                      key={`${item.emoji}-${idx}`}
                      type="button"
                      onClick={() => onSelectEmoji(item.emoji)}
                      className="aspect-square flex items-center justify-center text-xl hover:bg-[#252936] hover:scale-125 rounded-xl transition-all"
                      title={item.name}
                    >
                      {item.emoji}
                    </button>
                  ))}
                </div>
              </div>
            ))
        )}
      </div>

      <div className="px-3 py-1.5 bg-[#111318] border-t border-[#262A36] text-[10px] text-[#717585] text-center font-mono">
        Click an emoji to insert
      </div>
    </div>
  );
};
