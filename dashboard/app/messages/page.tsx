'use client';

import { useState } from 'react';
import { useMessages } from '@/lib/hooks';
import { Card } from '@/components/Card';
import { PageHeader } from '@/components/PageHeader';
import { EmptyState } from '@/components/EmptyState';
import { LoadingSpinner } from '@/components/LoadingSpinner';
import { MessageSquare, User, Bot } from 'lucide-react';

export default function MessagesPage() {
  const [limit] = useState(100);
  const { data, error, isLoading } = useMessages(limit, 0);

  return (
    <div className="p-6">
      <PageHeader
        title="Messages"
        description="View all conversations between users and the AI agent"
      />

      {error && (
        <Card className="border-red-200 dark:border-red-900 mb-4">
          <p className="text-[13px] text-red-600 dark:text-red-400" role="alert">
            Failed to load messages. The backend may be unavailable.
          </p>
        </Card>
      )}

      {isLoading && <LoadingSpinner label="Loading messages..." />}

      {data && data.messages.length === 0 && (
        <EmptyState
          icon={<MessageSquare className="w-10 h-10" />}
          title="No messages yet"
          description="Messages will appear here once the agent starts responding to iMessages."
        />
      )}

      {data && data.messages.length > 0 && (
        <div className="space-y-2">
          {data.messages.map((msg) => (
            <Card key={msg.id} padding="sm">
              <div className="flex items-start gap-3">
                <div
                  className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${
                    msg.role === 'user'
                      ? 'bg-blue-100 dark:bg-blue-950/40'
                      : 'bg-purple-100 dark:bg-purple-950/40'
                  }`}
                  aria-hidden="true"
                >
                  {msg.role === 'user' ? (
                    <User className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                  ) : (
                    <Bot className="w-4 h-4 text-purple-600 dark:text-purple-400" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-[12px] font-semibold">
                      {msg.role === 'user' ? (msg.userDisplayName || msg.userHandle || 'User') : 'AI Agent'}
                    </span>
                    <time
                      className="text-[11px] text-[var(--color-text-tertiary)]"
                      dateTime={msg.createdAt}
                    >
                      {new Date(msg.createdAt).toLocaleString()}
                    </time>
                  </div>
                  <p className="text-[13px] text-[var(--color-text-secondary)] whitespace-pre-wrap break-words">
                    {msg.content}
                  </p>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
