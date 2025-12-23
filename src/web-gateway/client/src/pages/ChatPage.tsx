import { useChat, useConnectionStatus } from '@/hooks';
import { MessageList, MessageInput } from '@/components';

export function ChatPage() {
	const { status } = useConnectionStatus(5000);
	const {
		messages,
		streamingContent,
		isLoading,
		error,
		sendMessage,
		cancelStream,
		clearMessages,
	} = useChat({ streaming: true });

	const isStreaming = isLoading && streamingContent.length > 0;

	return (
		<div className="flex flex-col h-screen bg-gray-100">
			{/* Header */}
			<header className="bg-white shadow-sm px-4 py-3 flex items-center justify-between">
				<div className="flex items-center space-x-4">
					<h1 className="text-lg font-semibold text-gray-900">Copilot Chat</h1>
					{messages.length > 0 && (
						<button
							onClick={clearMessages}
							className="text-sm text-gray-500 hover:text-gray-700 focus:outline-none"
							title="Clear conversation"
						>
							Clear
						</button>
					)}
				</div>
				<div className="flex items-center space-x-2">
					<span
						className={`w-2 h-2 rounded-full ${
							status?.connected ? 'bg-green-500' : 'bg-red-500'
						}`}
					/>
					<span className="text-sm text-gray-600">
						{status?.connected ? 'Connected' : 'Disconnected'}
					</span>
				</div>
			</header>

			{/* Error banner */}
			{error && !isLoading && (
				<div className="bg-red-50 border-b border-red-200 px-4 py-2">
					<p className="text-sm text-red-700">{error}</p>
				</div>
			)}

			{/* Messages */}
			<MessageList
				messages={messages}
				streamingContent={streamingContent}
				isLoading={isLoading}
			/>

			{/* Input */}
			<MessageInput
				onSend={sendMessage}
				disabled={isLoading && !isStreaming}
				isStreaming={isStreaming}
				onCancel={cancelStream}
				placeholder="Ask Copilot anything..."
			/>
		</div>
	);
}
