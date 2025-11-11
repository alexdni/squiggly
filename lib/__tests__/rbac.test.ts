import { describe, it, expect } from 'vitest';
import { hasPermission, getRolePermissions, canAssignRole } from '../rbac';
import type { ProjectRole } from '@/types/database';

describe('RBAC Utilities', () => {
  describe('hasPermission', () => {
    it('should allow owner all permissions', () => {
      expect(hasPermission('owner', 'project:read')).toBe(true);
      expect(hasPermission('owner', 'project:update')).toBe(true);
      expect(hasPermission('owner', 'project:delete')).toBe(true);
      expect(hasPermission('owner', 'project:manage_members')).toBe(true);
      expect(hasPermission('owner', 'recording:create')).toBe(true);
      expect(hasPermission('owner', 'recording:delete')).toBe(true);
      expect(hasPermission('owner', 'analysis:create')).toBe(true);
      expect(hasPermission('owner', 'export:create')).toBe(true);
    });

    it('should restrict collaborator from managing project and members', () => {
      expect(hasPermission('collaborator', 'project:read')).toBe(true);
      expect(hasPermission('collaborator', 'project:update')).toBe(false);
      expect(hasPermission('collaborator', 'project:delete')).toBe(false);
      expect(hasPermission('collaborator', 'project:manage_members')).toBe(false);
      expect(hasPermission('collaborator', 'recording:create')).toBe(true);
      expect(hasPermission('collaborator', 'recording:delete')).toBe(true);
      expect(hasPermission('collaborator', 'analysis:create')).toBe(true);
      expect(hasPermission('collaborator', 'export:create')).toBe(true);
    });

    it('should restrict viewer to read-only and export', () => {
      expect(hasPermission('viewer', 'project:read')).toBe(true);
      expect(hasPermission('viewer', 'project:update')).toBe(false);
      expect(hasPermission('viewer', 'project:delete')).toBe(false);
      expect(hasPermission('viewer', 'project:manage_members')).toBe(false);
      expect(hasPermission('viewer', 'recording:create')).toBe(false);
      expect(hasPermission('viewer', 'recording:delete')).toBe(false);
      expect(hasPermission('viewer', 'recording:read')).toBe(true);
      expect(hasPermission('viewer', 'analysis:create')).toBe(false);
      expect(hasPermission('viewer', 'analysis:read')).toBe(true);
      expect(hasPermission('viewer', 'export:create')).toBe(true);
    });
  });

  describe('getRolePermissions', () => {
    it('should return all owner permissions', () => {
      const permissions = getRolePermissions('owner');
      expect(permissions).toContain('project:read');
      expect(permissions).toContain('project:update');
      expect(permissions).toContain('project:delete');
      expect(permissions).toContain('project:manage_members');
      expect(permissions.length).toBeGreaterThan(8);
    });

    it('should return collaborator permissions without management rights', () => {
      const permissions = getRolePermissions('collaborator');
      expect(permissions).toContain('project:read');
      expect(permissions).toContain('recording:create');
      expect(permissions).not.toContain('project:manage_members');
      expect(permissions).not.toContain('project:delete');
    });

    it('should return limited viewer permissions', () => {
      const permissions = getRolePermissions('viewer');
      expect(permissions).toContain('project:read');
      expect(permissions).toContain('recording:read');
      expect(permissions).toContain('analysis:read');
      expect(permissions).toContain('export:create');
      expect(permissions).not.toContain('recording:create');
      expect(permissions).not.toContain('analysis:create');
      expect(permissions.length).toBeLessThan(6);
    });
  });

  describe('canAssignRole', () => {
    it('should allow owner to assign any role', () => {
      expect(canAssignRole('owner', 'owner')).toBe(true);
      expect(canAssignRole('owner', 'collaborator')).toBe(true);
      expect(canAssignRole('owner', 'viewer')).toBe(true);
    });

    it('should not allow collaborator to assign roles', () => {
      expect(canAssignRole('collaborator', 'viewer')).toBe(false);
      expect(canAssignRole('collaborator', 'collaborator')).toBe(false);
      expect(canAssignRole('collaborator', 'owner')).toBe(false);
    });

    it('should not allow viewer to assign roles', () => {
      expect(canAssignRole('viewer', 'viewer')).toBe(false);
      expect(canAssignRole('viewer', 'collaborator')).toBe(false);
      expect(canAssignRole('viewer', 'owner')).toBe(false);
    });
  });

  describe('Edge Cases', () => {
    it('should handle invalid role gracefully', () => {
      const invalidRole = 'admin' as ProjectRole;
      expect(hasPermission(invalidRole, 'project:read')).toBe(false);
      expect(getRolePermissions(invalidRole)).toEqual([]);
    });

    it('should be case-sensitive for roles', () => {
      const upperRole = 'OWNER' as ProjectRole;
      expect(hasPermission(upperRole, 'project:read')).toBe(false);
    });
  });
});
