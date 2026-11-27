import React, { useState } from 'react';
import { Users } from 'lucide-react';
import { sanitizeSafeMediaUrl } from './types';

interface AvatarBadgeProps {
  name: string;
  initials?: string;
  avatar?: string;
  size?: number;
  isGroup?: boolean;
  isOnline?: boolean;
  className?: string;
}

export const AvatarBadge: React.FC<AvatarBadgeProps> = ({
  name,
  initials,
  avatar,
  size = 40,
  isGroup = false,
  isOnline = false,
  className = '',
}) => {
  const [imgFailed, setImgFailed] = useState(false);
  const safeAvatar = !imgFailed ? sanitizeSafeMediaUrl(avatar) : '';
  const fallbackInitials =
    initials ||
    String(name || 'M')
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((p) => p[0]?.toUpperCase() || '')
      .join('') ||
    'M';

  return (
    <span
      className={`relative inline-flex shrink-0 items-center justify-center rounded-full select-none ${className}`}
      style={{ width: size, height: size }}
    >
      {isGroup ? (
        <span className="flex h-full w-full items-center justify-center rounded-full bg-[#4777DF]/15 text-[#4777DF] border border-[#4777DF]/25">
          <Users size={Math.max(14, Math.round(size * 0.44))} aria-hidden="true" />
        </span>
      ) : safeAvatar ? (
        <img
          src={safeAvatar}
          alt={name}
          referrerPolicy="no-referrer"
          onError={() => setImgFailed(true)}
          className="h-full w-full rounded-full object-cover border border-black/10 dark:border-white/10"
        />
      ) : (
        <span
          className="flex h-full w-full items-center justify-center rounded-full bg-[#242B35] text-[#F2F4F7] font-semibold tracking-tight border border-white/10"
          style={{ fontSize: Math.max(11, Math.round(size * 0.36)) }}
        >
          {fallbackInitials}
        </span>
      )}

      {!isGroup && isOnline && (
        <span
          aria-label="Online"
          className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-emerald-500 ring-2 ring-white dark:ring-[#171C23]"
        />
      )}
    </span>
  );
};
