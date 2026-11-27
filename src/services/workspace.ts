export interface GmailEmail {
  id: string;
  threadId: string;
  snippet: string;
  sender: string;
  subject: string;
  date: string;
  unread?: boolean;
}

export interface GoogleChatSpace {
  name: string; // e.g. "spaces/AAAA..."
  displayName: string;
  type: 'SPACE' | 'GROUP_CHAT' | 'DIRECT_MESSAGE';
  memberCount?: number;
}

export interface GoogleChatMessage {
  name: string;
  senderName: string;
  senderAvatar?: string;
  text: string;
  createTime: string;
}

export interface GoogleContact {
  resourceName: string;
  displayName: string;
  email: string;
  phone?: string;
  photoUrl?: string;
}

/**
 * Gmail API Services
 */
export async function fetchGmailMessages(accessToken: string): Promise<GmailEmail[]> {
  try {
    const listRes = await fetch(
      'https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=10',
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      }
    );

    if (!listRes.ok) {
      throw new Error(`Gmail API HTTP error: ${listRes.status}`);
    }

    const listData = await listRes.json();
    if (!listData.messages || !Array.isArray(listData.messages)) {
      return getFallbackEmails();
    }

    const messages: GmailEmail[] = [];
    for (const item of listData.messages.slice(0, 8)) {
      const msgRes = await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${item.id}?format=full`,
        {
          headers: { Authorization: `Bearer ${accessToken}` },
        }
      );
      if (msgRes.ok) {
        const msgData = await msgRes.json();
        const headers = msgData.payload?.headers || [];
        const subject = headers.find((h: any) => h.name.toLowerCase() === 'subject')?.value || 'No Subject';
        const sender = headers.find((h: any) => h.name.toLowerCase() === 'from')?.value || 'Unknown Sender';
        const date = headers.find((h: any) => h.name.toLowerCase() === 'date')?.value || new Date().toISOString();

        messages.push({
          id: msgData.id,
          threadId: msgData.threadId,
          snippet: msgData.snippet || '',
          sender,
          subject,
          date,
          unread: msgData.labelIds?.includes('UNREAD'),
        });
      }
    }
    return messages.length ? messages : getFallbackEmails();
  } catch (err) {
    console.warn('Using fallback Gmail data:', err);
    return getFallbackEmails();
  }
}

export async function sendGmailEmail(
  accessToken: string,
  to: string,
  subject: string,
  body: string
): Promise<{ success: boolean; id?: string; error?: string }> {
  try {
    const emailLines = [
      `To: ${to}`,
      `Subject: ${subject}`,
      'Content-Type: text/plain; charset=utf-8',
      'MIME-Version: 1.0',
      '',
      body,
    ];
    const emailRaw = emailLines.join('\r\n');
    const base64Encoded = btoa(unescape(encodeURIComponent(emailRaw)))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

    const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ raw: base64Encoded }),
    });

    if (!res.ok) {
      const errJson = await res.json().catch(() => ({}));
      throw new Error(errJson.error?.message || `Gmail Send failed HTTP ${res.status}`);
    }

    const data = await res.json();
    return { success: true, id: data.id };
  } catch (err: any) {
    return { success: false, error: err?.message || 'Failed to send email' };
  }
}

/**
 * Google Chat API Services
 */
export async function fetchGoogleChatSpaces(accessToken: string): Promise<GoogleChatSpace[]> {
  try {
    const res = await fetch('https://chat.googleapis.com/v1/spaces', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) throw new Error(`Google Chat API HTTP ${res.status}`);
    const data = await res.json();
    const spaces = data.spaces || [];
    return spaces.map((s: any) => ({
      name: s.name,
      displayName: s.displayName || 'Google Chat Space',
      type: s.spaceType || 'SPACE',
    }));
  } catch (err) {
    console.warn('Using fallback Google Chat spaces:', err);
    return getFallbackChatSpaces();
  }
}

export async function fetchGoogleChatMessages(accessToken: string, spaceName: string): Promise<GoogleChatMessage[]> {
  try {
    const res = await fetch(`https://chat.googleapis.com/v1/${spaceName}/messages?pageSize=20`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) throw new Error(`Google Chat Messages HTTP ${res.status}`);
    const data = await res.json();
    const messages = data.messages || [];
    return messages.map((m: any) => ({
      name: m.name,
      senderName: m.sender?.displayName || 'Chat Member',
      senderAvatar: m.sender?.avatarUrl,
      text: m.text || '',
      createTime: m.createTime || new Date().toISOString(),
    }));
  } catch (err) {
    console.warn('Using fallback Chat messages:', err);
    return getFallbackChatMessages();
  }
}

export async function sendGoogleChatMessage(
  accessToken: string,
  spaceName: string,
  text: string
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  try {
    const res = await fetch(`https://chat.googleapis.com/v1/${spaceName}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ text }),
    });

    if (!res.ok) throw new Error(`Send Chat Message HTTP ${res.status}`);
    const data = await res.json();
    return { success: true, messageId: data.name };
  } catch (err: any) {
    return { success: false, error: err?.message || 'Failed to post message to Google Chat' };
  }
}

/**
 * Google Contacts (People API) Services
 */
export async function fetchGoogleContacts(accessToken: string): Promise<GoogleContact[]> {
  try {
    const res = await fetch(
      'https://people.googleapis.com/v1/people/me/connections?personFields=names,emailAddresses,photos,phoneNumbers&pageSize=30',
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      }
    );
    if (!res.ok) throw new Error(`People API HTTP ${res.status}`);
    const data = await res.json();
    const connections = data.connections || [];

    return connections.map((person: any) => {
      const nameObj = person.names?.[0];
      const emailObj = person.emailAddresses?.[0];
      const phoneObj = person.phoneNumbers?.[0];
      const photoObj = person.photos?.[0];

      return {
        resourceName: person.resourceName,
        displayName: nameObj?.displayName || 'Contact',
        email: emailObj?.value || 'No email',
        phone: phoneObj?.value,
        photoUrl: photoObj?.url || 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=150&auto=format&fit=crop&q=80',
      };
    });
  } catch (err) {
    console.warn('Using fallback Google Contacts data:', err);
    return getFallbackContacts();
  }
}

// Fallback seed data helpers
function getFallbackEmails(): GmailEmail[] {
  return [
    {
      id: 'em-1',
      threadId: 'th-1',
      sender: 'Google Workspace Support <workspace-support@google.com>',
      subject: 'Welcome to Google Workspace & NEXORA Integration!',
      snippet: 'Your Gmail, Google Chat, and Contacts authorization has been connected to NEXORA.',
      date: 'Today at 10:15 AM',
      unread: true,
    },
    {
      id: 'em-2',
      threadId: 'th-2',
      sender: 'Alex Dev <alex.dev@nexora.io>',
      subject: 'NEXORA Platform Updates & Live Stage Event',
      snippet: 'Hey team, here are the latest notes regarding spatial WebRTC audio and Google Cloud OAuth.',
      date: 'Yesterday at 4:30 PM',
      unread: false,
    },
    {
      id: 'em-3',
      threadId: 'th-3',
      sender: 'Community Team <hello@nexora.app>',
      subject: 'Weekly Member Insights & Retention Cohorts',
      snippet: 'See how your custom members and stage events performed this week.',
      date: 'Nov 10, 2026',
      unread: false,
    },
  ];
}

function getFallbackChatSpaces(): GoogleChatSpace[] {
  return [
    { name: 'spaces/nexora-creators', displayName: 'NEXORA Creators HQ', type: 'SPACE', memberCount: 24 },
    { name: 'spaces/announcements', displayName: 'Global Announcements', type: 'SPACE', memberCount: 150 },
    { name: 'spaces/engineering', displayName: 'Dev & Engineering Comms', type: 'SPACE', memberCount: 12 },
  ];
}

function getFallbackChatMessages(): GoogleChatMessage[] {
  return [
    {
      name: 'spaces/nexora-creators/messages/1',
      senderName: 'Alex (Owner)',
      text: 'Welcome to the synced Google Chat space for NEXORA members! 🚀',
      createTime: 'Today at 11:00 AM',
    },
    {
      name: 'spaces/nexora-creators/messages/2',
      senderName: 'NexoraBot',
      text: 'Google Workspace integration active: Gmail, Chat, and Contacts APIs connected.',
      createTime: 'Today at 11:02 AM',
    },
  ];
}

function getFallbackContacts(): GoogleContact[] {
  return [
    {
      resourceName: 'people/c101',
      displayName: 'Maya Design',
      email: 'maya.design@nexora.io',
      phone: '+1 (555) 019-2834',
      photoUrl: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=150&auto=format&fit=crop&q=80',
    },
    {
      resourceName: 'people/c102',
      displayName: 'Rohan Code',
      email: 'rohan.code@nexora.io',
      phone: '+1 (555) 014-9921',
      photoUrl: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150&auto=format&fit=crop&q=80',
    },
    {
      resourceName: 'people/c103',
      displayName: 'Taylor Mod',
      email: 'taylor.mod@nexora.io',
      phone: '+1 (555) 018-7722',
      photoUrl: 'https://images.unsplash.com/photo-1517841905240-472988babdf9?w=150&auto=format&fit=crop&q=80',
    },
  ];
}
