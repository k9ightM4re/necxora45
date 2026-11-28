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
        <span className="flex h-full w-full items-center justify-center rounded-full bg-[#790B13]/12 text-[#790B13] border border-[#790B13]/25 dark:bg-[#790B13]/30 dark:text-[#FFF0DC]">
          <Users size={Math.max(14, Math.round(size * 0.44))} aria-hidden="true" />
        </span>
      ) : safeAvatar ? (
        <img
          src={safeAvatar}
          alt={name}
          referrerPolicy="no-referrer"
          onError={() => setImgFailed(true)}
          className="h-full w-full rounded-full object-cover border border-[#E8D3B8] dark:border-[#FFF0DC]/15"
        />
      ) : (
        <span
          className="flex h-full w-full items-center justify-center rounded-full bg-[#790B13] text-[#FFF0DC] font-semibold tracking-tight border border-[#E8D3B8]/40"
          style={{ fontSize: Math.max(11, Math.round(size * 0.36)) }}
        >
          {fallbackInitials}
        </span>
      )}

      {!isGroup && isOnline && (
        <span
          aria-label="Online"
          className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-emerald-600 ring-2 ring-[#FFF8EE] dark:ring-[#260A0D]"
        />
      )}
    </span>
  );
};
