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
        <div className="flex h-full w-full flex-1 flex-col items-center justify-center bg-[#FFF0DC] p-6 text-center dark:bg-[#1B0709]">
          <h3 className="text-base font-semibold text-[#2A0A0D] dark:text-[#FFF0DC]">
            Messages temporarily unavailable
          </h3>
          <p className="mt-1 text-[0.84rem] text-[#6B4A4D] dark:text-[#C89D8B]">
            {this.state.errorMsg}
          </p>
          <button
            type="button"
            onClick={() => this.setState({ hasError: false, errorMsg: '' })}
            className="mt-4 rounded-xl bg-[#790B13] px-4 py-2 text-[0.84rem] font-medium text-[#FFF0DC] hover:bg-[#5C0810]"
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
      <div className="flex h-full w-full min-w-0 flex-1 overflow-hidden bg-[#FFF0DC] text-[#2A0A0D] dark:bg-[#1B0709] dark:text-[#FFF0DC]">
        <ConversationPanel snapshot={snapshot} bridge={bridge} />
        <ActiveConversation snapshot={snapshot} bridge={bridge} />
      </div>
    </InboxErrorBoundary>
  );
};
