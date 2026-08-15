import { describe, expect, it } from 'vitest';

import {
  buildProjectQuickCaptureReturnTo,
  getProjectQuickCaptureReturnToProjectId,
} from '@/components/projects-screen/projects-screen.utils';

describe('project screen utilities', () => {
  it('builds an encoded return route for project quick capture', () => {
    expect(buildProjectQuickCaptureReturnTo('project one/alpha?x'))
      .toBe('/projects-screen?projectId=project%20one%2Falpha%3Fx');
  });

  it('reads the project id back out of a quick-capture return route', () => {
    expect(getProjectQuickCaptureReturnToProjectId(buildProjectQuickCaptureReturnTo('project one/alpha?x')))
      .toBe('project one/alpha?x');
    expect(getProjectQuickCaptureReturnToProjectId('/projects-screen?projectId=p1'))
      .toBe('p1');
  });

  it('returns null for non-project return routes', () => {
    expect(getProjectQuickCaptureReturnToProjectId(undefined)).toBeNull();
    expect(getProjectQuickCaptureReturnToProjectId('/inbox')).toBeNull();
    expect(getProjectQuickCaptureReturnToProjectId('/projects-screen')).toBeNull();
  });
});
