// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ArrayWidget,
  BooleanWidget,
  EnumWidget,
  NumberWidget,
  StringWidget,
} from '../src/settings/form/widgets.js';
import { field } from './settings-form-fixtures.js';

afterEach(cleanup);

const F = {
  boolean: field({ key: 'a.flag', widget: 'boolean', schema: { type: 'boolean', default: true } }),
  enum: field({
    key: 'a.budget',
    widget: 'enum',
    schema: { type: 'string', enum: ['free-only', 'free-first', 'any'], default: 'free-first' },
    options: { 'free-only': '무료만', 'free-first': '무료 먼저', any: '상관없음' },
  }),
  number: field({
    key: 'a.samples',
    widget: 'number',
    schema: { type: 'integer', minimum: 1, maximum: 3, default: 3 },
  }),
  string: field({ key: 'a.url', widget: 'string', schema: { type: 'string', default: '' } }),
  array: field({
    key: 'a.list',
    widget: 'array',
    schema: { type: 'array', items: { type: 'string' }, default: [] },
  }),
};

describe('T-101 0A.5 폼 자동 렌더러 위젯 5종', () => {
  it('켜기/끄기(boolean): 스냅샷 + 누르면 반대 값 저장', () => {
    const onCommit = vi.fn();
    const { container } = render(
      <BooleanWidget field={F.boolean} value inputId="w-bool" onCommit={onCommit} />,
    );
    expect(container.innerHTML).toMatchSnapshot();
    const sw = screen.getByRole('switch');
    expect(sw.getAttribute('aria-checked')).toBe('true');
    fireEvent.click(sw);
    expect(onCommit).toHaveBeenCalledWith(false);
  });

  it('선택(enum): 쉬운 이름 보기 + 바꾸면 바로 저장', () => {
    const onCommit = vi.fn();
    const { container } = render(
      <EnumWidget field={F.enum} value="free-first" inputId="w-enum" onCommit={onCommit} />,
    );
    expect(container.innerHTML).toMatchSnapshot();
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual([
      '무료만',
      '무료 먼저',
      '상관없음',
    ]);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'any' } });
    expect(onCommit).toHaveBeenCalledWith('any');
  });

  it('숫자(입력+범위): 범위 표시, 칸을 벗어나면 숫자로 저장, 숫자가 아니면 그대로 보내 거부받는다', () => {
    const onCommit = vi.fn();
    const { container } = render(
      <NumberWidget field={F.number} value={3} inputId="w-num" onCommit={onCommit} />,
    );
    expect(container.innerHTML).toMatchSnapshot();
    expect(screen.getByText('1~3')).toBeTruthy();
    const input = screen.getByRole('spinbutton') as HTMLInputElement;
    expect([input.min, input.max, input.step]).toEqual(['1', '3', '1']);
    fireEvent.change(input, { target: { value: '2' } });
    fireEvent.blur(input);
    expect(onCommit).toHaveBeenLastCalledWith(2);
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.blur(input);
    expect(onCommit).toHaveBeenLastCalledWith('');
  });

  it('글자(string): Enter나 칸 벗어나면 저장, 안 바뀌면 저장 안 함', () => {
    const onCommit = vi.fn();
    const { container } = render(
      <StringWidget field={F.string} value="" inputId="w-str" onCommit={onCommit} />,
    );
    expect(container.innerHTML).toMatchSnapshot();
    const input = screen.getByRole('textbox');
    fireEvent.blur(input);
    expect(onCommit).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: 'http://127.0.0.1:8080' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    fireEvent.blur(input);
    expect(onCommit).toHaveBeenCalledWith('http://127.0.0.1:8080');
  });

  it('목록(array): 추가·빼기', () => {
    const onCommit = vi.fn();
    const { container, rerender } = render(
      <ArrayWidget field={F.array} value={['a', 'b']} inputId="w-arr" onCommit={onCommit} />,
    );
    expect(container.innerHTML).toMatchSnapshot();
    fireEvent.click(screen.getByRole('button', { name: 'a 빼기' }));
    expect(onCommit).toHaveBeenLastCalledWith(['b']);
    fireEvent.change(screen.getByPlaceholderText('새 항목'), { target: { value: 'c' } });
    fireEvent.click(screen.getByRole('button', { name: '추가' }));
    expect(onCommit).toHaveBeenLastCalledWith(['a', 'b', 'c']);
    rerender(<ArrayWidget field={F.array} value={[]} inputId="w-arr" onCommit={onCommit} />);
    expect(screen.getByText('비어 있어요')).toBeTruthy();
  });
});
