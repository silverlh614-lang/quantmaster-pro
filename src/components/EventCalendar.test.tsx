// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { EventCalendar } from './EventCalendar';

describe('EventCalendar', () => {
  it('falls back to empty state when non-array events are provided', () => {
    const { getByText } = render(<EventCalendar events={{} as any} />);
    expect(getByText('예정된 주요 이벤트가 없습니다.')).toBeTruthy();
  });
});
