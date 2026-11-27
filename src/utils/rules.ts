import { Role, RolePermissions, Poll, Server } from '../types';

/**
 * Checks if user's roles grant a specific permission.
 * Administrator role automatically grants all permissions.
 */
export function hasPermission(roles: Role[], permissionKey: keyof RolePermissions): boolean {
  if (!roles || roles.length === 0) return false;
  return roles.some(role => role.permissions.administrator || Boolean(role.permissions[permissionKey]));
}

/**
 * Sanitizes and formats channel names according to Discord/Nexora standards:
 * lowercase, no spaces (replaced with dashes), only alphanumeric and dashes.
 */
export function sanitizeChannelName(input: string): { valid: boolean; formatted: string; error?: string } {
  const trimmed = input.trim().toLowerCase();
  if (!trimmed) {
    return { valid: false, formatted: '', error: 'Channel name cannot be empty.' };
  }
  const formatted = trimmed
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-_]/g, '')
    .slice(0, 32);

  if (formatted.length === 0) {
    return { valid: false, formatted: '', error: 'Channel name must contain alphanumeric characters.' };
  }

  return { valid: true, formatted };
}

/**
 * Validates server creation names.
 */
export function validateServerName(name: string): { valid: boolean; error?: string } {
  const trimmed = name.trim();
  if (trimmed.length < 2) {
    return { valid: false, error: 'Server name must be at least 2 characters.' };
  }
  if (trimmed.length > 50) {
    return { valid: false, error: 'Server name cannot exceed 50 characters.' };
  }
  return { valid: true };
}

/**
 * Toggles a user's vote on a poll option.
 * If user already voted on this option, vote is retracted.
 * If user voted on another option, vote is moved.
 */
export function castPollVote(poll: Poll, optionId: string, userId: string): Poll {
  const alreadyVotedOption = poll.options.find(opt => opt.votedUserIds.includes(userId));
  const isRetracting = alreadyVotedOption?.id === optionId;

  const updatedOptions = poll.options.map(opt => {
    const hasVotedThis = opt.votedUserIds.includes(userId);
    if (opt.id === optionId) {
      if (isRetracting) {
        return {
          ...opt,
          votes: Math.max(0, opt.votes - 1),
          votedUserIds: opt.votedUserIds.filter(id => id !== userId),
        };
      } else {
        return {
          ...opt,
          votes: opt.votes + 1,
          votedUserIds: [...opt.votedUserIds, userId],
        };
      }
    } else if (hasVotedThis) {
      // Remove previous vote from other option
      return {
        ...opt,
        votes: Math.max(0, opt.votes - 1),
        votedUserIds: opt.votedUserIds.filter(id => id !== userId),
      };
    }
    return opt;
  });

  const totalVotes = updatedOptions.reduce((acc, curr) => acc + curr.votes, 0);

  return {
    ...poll,
    options: updatedOptions,
    totalVotes,
  };
}

/**
 * Calculates percentage for poll options safely.
 */
export function calculatePollPercentage(votes: number, totalVotes: number): number {
  if (totalVotes <= 0) return 0;
  return Math.round((votes / totalVotes) * 100);
}

/**
 * Filters community discovery list by search term and category filter.
 */
export function filterDiscoveryServers(
  servers: Server[],
  searchTerm: string,
  selectedCategory: string
): Server[] {
  const query = searchTerm.trim().toLowerCase();
  return servers.filter(srv => {
    const matchesCategory =
      selectedCategory === 'All' ||
      srv.category.toLowerCase() === selectedCategory.toLowerCase();

    if (!matchesCategory) return false;
    if (!query) return true;

    const matchesName = srv.name.toLowerCase().includes(query);
    const matchesDesc = srv.description.toLowerCase().includes(query);
    const matchesTags = srv.tags?.some(tag => tag.toLowerCase().includes(query));

    return matchesName || matchesDesc || matchesTags;
  });
}

/**
 * Formats a timestamp into humanized Discord-style time.
 */
export function formatMessageTime(isoString: string): string {
  try {
    const date = new Date(isoString);
    if (isNaN(date.getTime())) return 'Recently';

    const now = new Date();
    const isToday =
      date.getDate() === now.getDate() &&
      date.getMonth() === now.getMonth() &&
      date.getFullYear() === now.getFullYear();

    const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    if (isToday) {
      return `Today at ${timeStr}`;
    }

    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    const isYesterday =
      date.getDate() === yesterday.getDate() &&
      date.getMonth() === yesterday.getMonth() &&
      date.getFullYear() === yesterday.getFullYear();

    return `${date.toLocaleDateString([], { month: 'short', day: 'numeric' })} at ${timeStr}`;
  } catch {
    return 'Recently';
  }
}
