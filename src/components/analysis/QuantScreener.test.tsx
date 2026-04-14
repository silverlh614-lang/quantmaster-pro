// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import { QuantScreener } from './QuantScreener';

describe('QuantScreener', () => {
  it('submits default filters when screening starts', () => {
    const onScreen = vi.fn().mockResolvedValue(undefined);
    const { getByText } = render(
      <QuantScreener
        onScreen={onScreen}
        loading={false}
        recommendations={[]}
      />
    );

    fireEvent.click(getByText('스크리닝 시작'));

    expect(onScreen).toHaveBeenCalledTimes(1);
    expect(onScreen).toHaveBeenCalledWith({
      minRoe: 15,
      maxPer: 20,
      maxDebtRatio: 100,
      minMarketCap: 1000,
      mode: 'MOMENTUM',
    });
  });
});
