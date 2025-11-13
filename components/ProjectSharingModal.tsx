'use client';

import { useState, useEffect } from 'react';
import type { ProjectRole } from '@/types/database';

interface Member {
  id: string;
  user_id: string;
  role: ProjectRole;
  created_at: string | null;
}

interface ProjectSharingModalProps {
  projectId: string;
  isOpen: boolean;
  onClose: () => void;
  userRole: ProjectRole;
}

export default function ProjectSharingModal({
  projectId,
  isOpen,
  onClose,
  userRole,
}: ProjectSharingModalProps) {
  const [members, setMembers] = useState<Member[]>([]);
  const [newMemberEmail, setNewMemberEmail] = useState('');
  const [newMemberRole, setNewMemberRole] = useState<ProjectRole>('viewer');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canManageMembers = userRole === 'owner';

  useEffect(() => {
    if (isOpen) {
      fetchMembers();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, projectId]);

  const fetchMembers = async () => {
    try {
      const response = await fetch(`/api/projects/${projectId}/members`);
      if (!response.ok) throw new Error('Failed to fetch members');
      const data = await response.json();
      setMembers(data.members);
    } catch (err) {
      console.error('Error fetching members:', err);
      setError('Failed to load members');
    }
  };

  const handleAddMember = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canManageMembers) return;

    setIsLoading(true);
    setError(null);

    try {
      // Note: In production, you'd look up user_id by email via an API endpoint
      const response = await fetch(`/api/projects/${projectId}/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: newMemberEmail, // Simplified - should be actual user_id
          role: newMemberRole,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to add member');
      }

      setNewMemberEmail('');
      setNewMemberRole('viewer');
      await fetchMembers();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleRemoveMember = async (memberId: string) => {
    if (!canManageMembers) return;

    try {
      const response = await fetch(
        `/api/projects/${projectId}/members?memberId=${memberId}`,
        { method: 'DELETE' }
      );

      if (!response.ok) throw new Error('Failed to remove member');

      await fetchMembers();
    } catch (err) {
      console.error('Error removing member:', err);
      setError('Failed to remove member');
    }
  };

  const getRoleBadgeColor = (role: ProjectRole) => {
    switch (role) {
      case 'owner':
        return 'bg-neuro-primary text-white';
      case 'collaborator':
        return 'bg-neuro-secondary text-white';
      case 'viewer':
        return 'bg-gray-400 text-white';
      default:
        return 'bg-gray-300 text-gray-700';
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full mx-4 max-h-[90vh] overflow-hidden flex flex-col">
        <div className="p-6 border-b border-gray-200">
          <div className="flex justify-between items-center">
            <h2 className="text-2xl font-bold text-neuro-dark">
              Project Sharing
            </h2>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-800 transition-colors"
            >
              <svg
                className="w-6 h-6"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>
        </div>

        <div className="p-6 overflow-y-auto flex-1">
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded mb-4">
              {error}
            </div>
          )}

          {canManageMembers && (
            <form onSubmit={handleAddMember} className="mb-6">
              <h3 className="font-semibold text-neuro-dark mb-3">
                Add Member
              </h3>
              <div className="flex gap-3">
                <input
                  type="email"
                  value={newMemberEmail}
                  onChange={(e) => setNewMemberEmail(e.target.value)}
                  placeholder="Email address"
                  required
                  className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-neuro-primary"
                />
                <select
                  value={newMemberRole}
                  onChange={(e) => setNewMemberRole(e.target.value as ProjectRole)}
                  className="px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-neuro-primary"
                >
                  <option value="viewer">Viewer</option>
                  <option value="collaborator">Collaborator</option>
                </select>
                <button
                  type="submit"
                  disabled={isLoading}
                  className="bg-neuro-primary text-white px-6 py-2 rounded-lg hover:bg-neuro-accent transition-colors disabled:opacity-50"
                >
                  {isLoading ? 'Adding...' : 'Add'}
                </button>
              </div>
              <p className="text-xs text-gray-700 mt-2">
                Note: Email-based invites will be implemented in future version
              </p>
            </form>
          )}

          <div>
            <h3 className="font-semibold text-neuro-dark mb-3">
              Current Members ({members.length})
            </h3>
            <div className="space-y-2">
              {members.map((member) => (
                <div
                  key={member.id}
                  className="flex items-center justify-between p-3 bg-gray-50 rounded-lg"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-neuro-primary text-white rounded-full flex items-center justify-center font-semibold">
                      {member.user_id.substring(0, 2).toUpperCase()}
                    </div>
                    <div>
                      <p className="font-medium text-neuro-dark">
                        {member.user_id}
                      </p>
                      <span
                        className={`inline-block text-xs px-2 py-1 rounded-full ${getRoleBadgeColor(
                          member.role
                        )}`}
                      >
                        {member.role}
                      </span>
                    </div>
                  </div>
                  {canManageMembers && member.role !== 'owner' && (
                    <button
                      onClick={() => handleRemoveMember(member.id)}
                      className="text-red-600 hover:text-red-800 text-sm font-medium"
                    >
                      Remove
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div className="mt-6 p-4 bg-blue-50 rounded-lg">
            <h4 className="font-semibold text-neuro-dark mb-2">
              Role Permissions
            </h4>
            <ul className="text-sm text-gray-700 space-y-1">
              <li>
                <strong>Owner:</strong> Full access - manage project, members,
                recordings, and analyses
              </li>
              <li>
                <strong>Collaborator:</strong> Upload recordings, run analyses,
                export results
              </li>
              <li>
                <strong>Viewer:</strong> View recordings, analyses, and export
                results
              </li>
            </ul>
          </div>
        </div>

        <div className="p-6 border-t border-gray-200">
          <button
            onClick={onClose}
            className="w-full bg-gray-200 text-gray-700 px-6 py-3 rounded-lg hover:bg-gray-300 transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
