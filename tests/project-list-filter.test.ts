import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isGardenSettingsProject } from '../src/settings/projects/project-list-filter.ts';

const vault = 'ws_this_vault';

describe('isGardenSettingsProject', () => {
	it('keeps folder projects for this vault', () => {
		assert.equal(
			isGardenSettingsProject({ kind: 'folder', workspaceId: vault }, vault),
			true,
		);
	});

	it('keeps legacy folder rows with empty workspaceId', () => {
		assert.equal(isGardenSettingsProject({ kind: 'folder', workspaceId: null }, vault), true);
		assert.equal(isGardenSettingsProject({ kind: 'folder', workspaceId: '' }, vault), true);
		assert.equal(isGardenSettingsProject({ kind: 'folder' }, vault), true);
	});

	it('drops Share notes and other-vault folders', () => {
		assert.equal(
			isGardenSettingsProject({ kind: 'note', workspaceId: vault }, vault),
			false,
		);
		assert.equal(
			isGardenSettingsProject({ kind: 'folder', workspaceId: 'ws_other' }, vault),
			false,
		);
	});

	it('drops deleted and missing kind', () => {
		assert.equal(
			isGardenSettingsProject(
				{ kind: 'folder', status: 'deleted', workspaceId: vault },
				vault,
			),
			false,
		);
		assert.equal(isGardenSettingsProject({ workspaceId: vault }, vault), false);
	});
});
