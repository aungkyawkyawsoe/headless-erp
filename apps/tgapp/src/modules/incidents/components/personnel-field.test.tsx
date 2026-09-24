// @vitest-environment jsdom
import type { ReactElement } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PersonnelField } from './personnel-field';
import type { PersonnelOption } from '@/shared/components/personnel-picker-sheet';

afterEach(cleanup);

// The field mounts the picker sheet, whose `useQuery` needs a client — even while
// the sheet is closed (the hook always runs).
const renderField = (ui: ReactElement) =>
	render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>);

const person = (overrides: Partial<PersonnelOption> = {}): PersonnelOption => ({
	id: 'p1',
	name: 'U Soe Naing',
	photo: null,
	...overrides,
});

describe('PersonnelField', () => {
	it('shows an empty hint and the add control when no one is selected', () => {
		renderField(<PersonnelField value={[]} onChange={() => {}} />);

		expect(screen.getByText(/No one added yet/)).toBeTruthy();
		expect(screen.getByRole('button', { name: /Add personnel/ })).toBeTruthy();
	});

	it('renders a chip per selected person', () => {
		renderField(<PersonnelField value={[person(), person({ id: 'p2', name: 'Aung Kyaw' })]} onChange={() => {}} />);

		expect(screen.getByText('U Soe Naing')).toBeTruthy();
		expect(screen.getByText('Aung Kyaw')).toBeTruthy();
		expect(screen.queryByText(/No one added yet/)).toBeNull();
	});

	it('removes one person from the selection when their chip is cleared', () => {
		const onChange = vi.fn();
		renderField(<PersonnelField value={[person(), person({ id: 'p2', name: 'Aung Kyaw' })]} onChange={onChange} />);

		fireEvent.click(screen.getByRole('button', { name: 'Remove U Soe Naing' }));

		expect(onChange).toHaveBeenCalledWith([expect.objectContaining({ id: 'p2' })]);
	});
});
