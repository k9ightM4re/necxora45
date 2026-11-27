import React, { useState } from 'react';
import { useNexora } from '../../context/NexoraContext';
import {
  MessageSquareText,
  ThumbsUp,
  Tag,
  Plus,
  Pin,
  Search,
  X,
  MessageCircle,
} from 'lucide-react';
import { ForumPost } from '../../types';

export const ForumWorkspace: React.FC = () => {
  const {
    activeChannel,
    forumPosts,
    createForumPost,
    upvoteForumPost,
    setSelectedUserProfile,
  } = useNexora();

  const [isCreatingPost, setIsCreatingPost] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newContent, setNewContent] = useState('');
  const [newTags, setNewTags] = useState('');
  const [selectedTag, setSelectedTag] = useState<string | null>(null);

  if (!activeChannel) return null;

  const channelPosts = forumPosts.filter(p => p.channelId === activeChannel.id);
  const filteredPosts = selectedTag
    ? channelPosts.filter(p => p.tags.includes(selectedTag))
    : channelPosts;

  const allTags = Array.from(new Set(channelPosts.flatMap(p => p.tags)));

  const handlePostSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim() || !newContent.trim()) return;

    const tagsArray = newTags
      .split(',')
      .map(t => t.trim().toLowerCase())
      .filter(t => t.length > 0);

    createForumPost(activeChannel.id, newTitle, newContent, tagsArray);
    setIsCreatingPost(false);
    setNewTitle('');
    setNewContent('');
    setNewTags('');
  };

  return (
    <div
      className="flex-1 flex flex-col h-full bg-[#111318] overflow-hidden select-none"
      aria-label="Forum workspace"
    >
      {/* Forum Header */}
      <header className="h-12 border-b border-[#1f232f] px-4 flex items-center justify-between flex-shrink-0 bg-[#111318]">
        <div className="flex items-center gap-2">
          <MessageSquareText className="w-5 h-5 text-[#7667F7]" />
          <h1 className="text-sm font-bold text-white">#{activeChannel.name}</h1>
        </div>

        <button
          onClick={() => setIsCreatingPost(true)}
          className="px-3 py-1.5 bg-[#7667F7] hover:bg-[#6353f4] text-white text-xs font-bold rounded-xl flex items-center gap-1.5 transition-colors shadow-md shadow-[#7667F7]/20"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>New Post</span>
        </button>
      </header>

      {/* Filter Tags */}
      {allTags.length > 0 && (
        <div className="px-4 py-2 border-b border-[#1f232f] flex items-center gap-2 overflow-x-auto scrollbar-none">
          <span className="text-xs text-[#9B9EAC] font-semibold">Tags:</span>
          <button
            onClick={() => setSelectedTag(null)}
            className={`px-2.5 py-0.5 rounded-lg text-xs font-semibold transition-colors ${
              selectedTag === null
                ? 'bg-[#7667F7] text-white'
                : 'bg-[#191C24] text-[#9B9EAC] hover:text-white'
            }`}
          >
            All
          </button>
          {allTags.map(tag => (
            <button
              key={tag}
              onClick={() => setSelectedTag(selectedTag === tag ? null : tag)}
              className={`px-2.5 py-0.5 rounded-lg text-xs font-semibold transition-colors ${
                selectedTag === tag
                  ? 'bg-[#7667F7] text-white'
                  : 'bg-[#191C24] text-[#9B9EAC] hover:text-white'
              }`}
            >
              #{tag}
            </button>
          ))}
        </div>
      )}

      {/* Posts List */}
      <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-3">
        {filteredPosts.map(post => (
          <div
            key={post.id}
            className="p-4 rounded-2xl bg-[#191C24] border border-[#262A36] hover:border-[#7667F7] transition-all space-y-2.5 shadow-lg"
          >
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  {post.pinned && (
                    <span className="flex items-center gap-1 text-[10px] font-bold text-[#EAB308]">
                      <Pin className="w-3 h-3" /> Pinned
                    </span>
                  )}
                  <h3 className="text-sm font-bold text-white hover:text-[#7667F7] cursor-pointer transition-colors">
                    {post.title}
                  </h3>
                </div>
                <p className="text-xs text-[#9B9EAC] line-clamp-2">
                  {post.content}
                </p>
              </div>

              {/* Upvote Button */}
              <button
                onClick={() => upvoteForumPost(post.id)}
                className={`flex flex-col items-center justify-center p-2 rounded-xl border transition-all flex-shrink-0 min-w-[48px] ${
                  post.upvotedByMe
                    ? 'bg-[#7667F7]/20 border-[#7667F7] text-[#7667F7]'
                    : 'bg-[#111318] border-[#262A36] text-[#9B9EAC] hover:text-white hover:border-[#3b4154]'
                }`}
              >
                <ThumbsUp className="w-4 h-4" />
                <span className="text-xs font-bold mt-1">{post.upvotes}</span>
              </button>
            </div>

            {/* Author, Tags & Replies Counter */}
            <div className="flex items-center justify-between text-xs pt-1 border-t border-[#202430]">
              <div
                onClick={() => setSelectedUserProfile(post.author)}
                className="flex items-center gap-2 cursor-pointer"
              >
                <img
                  src={post.author.avatar}
                  alt={post.author.displayName}
                  className="w-5 h-5 rounded-full object-cover"
                />
                <span className="text-[#9B9EAC] font-medium hover:underline">
                  {post.author.displayName} • {post.createdAt}
                </span>
              </div>

              <div className="flex items-center gap-3">
                <div className="flex gap-1">
                  {post.tags.map(t => (
                    <span
                      key={t}
                      className="px-1.5 py-0.2 rounded bg-[#111318] text-[#7667F7] text-[10px] font-semibold"
                    >
                      #{t}
                    </span>
                  ))}
                </div>
                <span className="text-[#9B9EAC] flex items-center gap-1">
                  <MessageCircle className="w-3.5 h-3.5" />
                  {post.repliesCount}
                </span>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Create Post Modal */}
      {isCreatingPost && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-[#191C24] border border-[#2b303d] rounded-2xl w-full max-w-lg p-5 shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-[#282d3b]">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <MessageSquareText className="w-4 h-4 text-[#7667F7]" />
                Create Forum Post
              </h3>
              <button
                onClick={() => setIsCreatingPost(false)}
                className="text-[#9B9EAC] hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handlePostSubmit} className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-[#9B9EAC] mb-1">
                  Title
                </label>
                <input
                  type="text"
                  required
                  placeholder="Give your topic a clear, concise title..."
                  value={newTitle}
                  onChange={e => setNewTitle(e.target.value)}
                  className="w-full bg-[#111318] border border-[#262A36] rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-[#7667F7]"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#9B9EAC] mb-1">
                  Content
                </label>
                <textarea
                  rows={4}
                  required
                  placeholder="Share details, context, code snippets or questions..."
                  value={newContent}
                  onChange={e => setNewContent(e.target.value)}
                  className="w-full bg-[#111318] border border-[#262A36] rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-[#7667F7] resize-none"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#9B9EAC] mb-1">
                  Tags (comma separated)
                </label>
                <input
                  type="text"
                  placeholder="e.g. react, design, bug, idea"
                  value={newTags}
                  onChange={e => setNewTags(e.target.value)}
                  className="w-full bg-[#111318] border border-[#262A36] rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-[#7667F7]"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsCreatingPost(false)}
                  className="px-3 py-1.5 bg-[#252936] text-xs font-semibold text-[#9B9EAC] rounded-xl hover:text-white"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 bg-[#7667F7] text-xs font-bold text-white rounded-xl hover:bg-[#6353f4]"
                >
                  Publish Post
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
