import React from 'react';
import { ActiveConversation } from './ActiveConversation';
import { ConversationPanel } from './ConversationPanel';
import { useNexoraBridge } from './useInboxStore';

class InboxErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; errorMsg: string }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, errorMsg: '' };
  }

  static getDerivedStateFromError(error: unknown) {
    return {
      hasError: true,
      errorMsg: error instanceof Error ? error.message : 'Unable to render messages workspace.',
    };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex h-full w-full flex-1 flex-col items-center justify-center bg-[#F5F6F8] p-6 text-center dark:bg-[#101318]">
          <h3 className="text-base font-semibold text-[#202630] dark:text-[#F2F4F7]">
            Messages temporarily unavailable
          </h3>
          <p className="mt-1 text-[0.84rem] text-[#596473] dark:text-[#A8B0BB]">
            {this.state.errorMsg}
          </p>
          <button
            type="button"
            onClick={() => this.setState({ hasError: false, errorMsg: '' })}
            className="mt-4 rounded-xl bg-[#3868CE] px-4 py-2 text-[0.84rem] font-medium text-white hover:bg-[#2D58B8]"
          >
            Reload Messages
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

export const NexoraInboxApp: React.FC = () => {
  const { snapshot, bridge } = useNexoraBridge();

  return (
    <InboxErrorBoundary>
      <div className="flex h-full w-full min-w-0 flex-1 overflow-hidden bg-[#F5F6F8] text-[#202630] dark:bg-[#101318] dark:text-[#F2F4F7]">
        <ConversationPanel snapshot={snapshot} bridge={bridge} />
        <ActiveConversation snapshot={snapshot} bridge={bridge} />
      </div>
    </InboxErrorBoundary>
  );
};
