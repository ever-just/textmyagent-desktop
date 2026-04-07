'use client';

import { useState } from 'react';
import { useUsers, useUserMessages } from '@/lib/hooks';
import { Card } from '@/components/Card';
import { PageHeader } from '@/components/PageHeader';
import { EmptyState } from '@/components/EmptyState';
import { LoadingSpinner } from '@/components/LoadingSpinner';
import { Users, User, Bot, ArrowLeft, MessageSquare } from 'lucide-react';
import { Button } from '@/components/Button';

export default function UsersPage() {
  const { data, error, isLoading } = useUsers();
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const { data: userMsgs, isLoading: msgsLoading } = useUserMessages(selectedUserId);

  const selectedUser = data?.users?.find((u) => u.id === selectedUserId);

  if (selectedUserId && selectedUser) {
    return (
      <div className="p-6">
        <div className="mb-4">
          <Button
            variant="ghost"
            size="sm"
            icon={<ArrowLeft className="w-3.5 h-3.5" />}
            onClick={() => setSelectedUserId(null)}
          >
            Back to Users
          </Button>
        </div>
        <PageHeader
          title={selectedUser.displayName || selectedUser.handle}
          description={selectedUser.handle}
        />

        {msgsLoading && <LoadingSpinner label="Loading conversation..." />}

        {userMsgs && userMsgs.messages.length === 0 && (
          <EmptyState
            icon={<MessageSquare className="w-10 h-10" />}
            title="No messages"
            description="No conversation history with this user yet."
          />
        )}

        {userMsgs && userMsgs.messages.length > 0 && (
          <div className="space-y-2">
            {userMsgs.messages.map((msg) => (
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
                        {msg.role === 'user' ? (selectedUser.displayName || 'User') : 'AI Agent'}
                      </span>
                      <time className="text-[11px] text-[var(--color-text-tertiary)]" dateTime={msg.createdAt}>
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

  return (
    <div className="p-6">
      <PageHeader
        title="Users"
        description="People who have communicated with your AI agent"
      />

      {error && (
        <Card className="border-red-200 dark:border-red-900 mb-4">
          <p className="text-[13px] text-red-600 dark:text-red-400" role="alert">
            Failed to load users.
          </p>
        </Card>
      )}

      {isLoading && <LoadingSpinner label="Loading users..." />}

      {data && data.users.length === 0 && (
        <EmptyState
          icon={<Users className="w-10 h-10" />}
          title="No users yet"
          description="Users will appear here after they send messages to your AI agent."
        />
      )}

      {data && data.users.length > 0 && (
        <div className="space-y-2">
          {data.users.map((user) => (
            <button
              key={user.id}
              onClick={() => setSelectedUserId(user.id)}
              className="w-full text-left"
              aria-label={`View conversation with ${user.displayName || user.handle}`}
            >
              <Card padding="sm" className="hover:border-[var(--color-brand)] transition-colors cursor-pointer">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-blue-100 dark:bg-blue-950/40 flex items-center justify-center flex-shrink-0" aria-hidden="true">
                    <User className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-semibold truncate">{user.displayName || user.handle}</p>
                    <p className="text-[12px] text-[var(--color-text-tertiary)] truncate">{user.handle}</p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="text-[12px] text-[var(--color-text-secondary)]">
                      {user.conversationCount} conversation{user.conversationCount !== 1 ? 's' : ''}
                    </p>
                    {user.lastMessageAt && (
                      <time className="text-[11px] text-[var(--color-text-tertiary)]" dateTime={user.lastMessageAt}>
                        {new Date(user.lastMessageAt).toLocaleDateString()}
                      </time>
                    )}
                  </div>
                </div>
              </Card>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
