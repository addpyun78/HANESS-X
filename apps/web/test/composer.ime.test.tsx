// @vitest-environment jsdom
import { cleanup, screen } from '@testing-library/react';
import { afterEach, describe } from 'vitest';
import type { SendPayload } from '../src/composer/types.js';
import { renderComposer } from './composer.helpers.js';
import { imeCases } from './ime-cases.js';

afterEach(cleanup);

describe('멀티라인 입력·Enter 전송·IME', () => {
  imeCases({
    render: () => {
      const { onSend } = renderComposer();
      return { onSend, input: () => screen.getByLabelText('지시 입력') as HTMLTextAreaElement };
    },
    sentText: (call) => (call[0] as SendPayload).text,
  });
});
