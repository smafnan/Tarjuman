import { describe, expect, it, vi } from 'vitest';

import { createHoldKey, createPushToTalkKeys, elementOwnsSpace, type KeyLike } from './pushToTalk';

function key(overrides: Partial<KeyLike> = {}) {
  return {
    code: 'Space',
    repeat: false,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    target: { tagName: 'BUTTON' } as unknown,
    preventDefault: vi.fn(),
    ...overrides,
  };
}

function setup(dialogOpen = false) {
  const setHeld = vi.fn();
  const keys = createPushToTalkKeys({ setHeld, dialogOpen: () => dialogOpen });
  return { keys, setHeld };
}

describe('elementOwnsSpace', () => {
  it('lets text fields, text areas, selects and editable content keep Space', () => {
    expect(elementOwnsSpace({ tagName: 'INPUT', type: 'text' })).toBe(true);
    expect(elementOwnsSpace({ tagName: 'INPUT', type: 'search' })).toBe(true);
    expect(elementOwnsSpace({ tagName: 'INPUT' })).toBe(true);
    expect(elementOwnsSpace({ tagName: 'TEXTAREA' })).toBe(true);
    expect(elementOwnsSpace({ tagName: 'SELECT' })).toBe(true);
    expect(elementOwnsSpace({ tagName: 'DIV', isContentEditable: true })).toBe(true);
  });

  it('lets check boxes and radio buttons keep Space so switches stay operable from the keyboard', () => {
    expect(elementOwnsSpace({ tagName: 'INPUT', type: 'checkbox' })).toBe(true);
    expect(elementOwnsSpace({ tagName: 'INPUT', type: 'radio' })).toBe(true);
  });

  it('does not keep Space for buttons, sliders or the page', () => {
    expect(elementOwnsSpace({ tagName: 'BUTTON' })).toBe(false);
    expect(elementOwnsSpace({ tagName: 'INPUT', type: 'button' })).toBe(false);
    expect(elementOwnsSpace({ tagName: 'INPUT', type: 'range' })).toBe(false);
    expect(elementOwnsSpace({ tagName: 'BODY' })).toBe(false);
    expect(elementOwnsSpace(null)).toBe(false);
  });
});

describe('createPushToTalkKeys', () => {
  it('holds and releases the microphone while Space is down, even with a button focused', () => {
    const { keys, setHeld } = setup();
    const down = key();
    keys.keydown(down);
    expect(setHeld).toHaveBeenLastCalledWith(true);
    expect(down.preventDefault).toHaveBeenCalled();

    const up = key();
    keys.keyup(up);
    expect(setHeld).toHaveBeenLastCalledWith(false);
    // Without this the focused "Stop microphone" button would be clicked on key up.
    expect(up.preventDefault).toHaveBeenCalled();
    expect(setHeld).toHaveBeenCalledTimes(2);
  });

  it('swallows auto-repeat without holding again', () => {
    const { keys, setHeld } = setup();
    keys.keydown(key());
    const repeat = key({ repeat: true });
    keys.keydown(repeat);
    expect(repeat.preventDefault).toHaveBeenCalled();
    expect(setHeld).toHaveBeenCalledTimes(1);
  });

  it('leaves Space alone in a text field', () => {
    const { keys, setHeld } = setup();
    const down = key({ target: { tagName: 'TEXTAREA' } });
    keys.keydown(down);
    expect(setHeld).not.toHaveBeenCalled();
    expect(down.preventDefault).not.toHaveBeenCalled();

    const up = key();
    keys.keyup(up);
    expect(up.preventDefault).not.toHaveBeenCalled();
  });

  it('leaves Space alone while a dialog is open', () => {
    const { keys, setHeld } = setup(true);
    const down = key();
    keys.keydown(down);
    expect(setHeld).not.toHaveBeenCalled();
    expect(down.preventDefault).not.toHaveBeenCalled();
  });

  it('ignores other keys and shortcuts', () => {
    const { keys, setHeld } = setup();
    keys.keydown(key({ code: 'Enter' }));
    keys.keydown(key({ ctrlKey: true }));
    keys.keydown(key({ metaKey: true }));
    keys.keydown(key({ altKey: true }));
    expect(setHeld).not.toHaveBeenCalled();
  });

  it('does not start from an auto-repeat that began somewhere else', () => {
    const { keys, setHeld } = setup();
    keys.keydown(key({ repeat: true }));
    expect(setHeld).not.toHaveBeenCalled();
  });

  it('lets go when the window loses focus', () => {
    const { keys, setHeld } = setup();
    keys.keydown(key());
    keys.release();
    expect(setHeld).toHaveBeenLastCalledWith(false);
    keys.release();
    expect(setHeld).toHaveBeenCalledTimes(2);
  });
});

describe('createHoldKey', () => {
  it('holds on Enter down and releases on Enter up', () => {
    const setHeld = vi.fn();
    const hold = createHoldKey(['Enter'], setHeld);
    const down = { key: 'Enter', repeat: false, preventDefault: vi.fn() };
    hold.keydown(down);
    hold.keydown({ key: 'Enter', repeat: true, preventDefault: vi.fn() });
    expect(setHeld).toHaveBeenCalledTimes(1);
    expect(setHeld).toHaveBeenLastCalledWith(true);
    expect(down.preventDefault).toHaveBeenCalled();

    hold.keyup({ key: 'Enter', preventDefault: vi.fn() });
    expect(setHeld).toHaveBeenLastCalledWith(false);
  });

  it('ignores other keys and a release without a hold', () => {
    const setHeld = vi.fn();
    const hold = createHoldKey(['Enter'], setHeld);
    hold.keydown({ key: 'a', repeat: false, preventDefault: vi.fn() });
    hold.keyup({ key: 'Enter', preventDefault: vi.fn() });
    hold.release();
    expect(setHeld).not.toHaveBeenCalled();
  });

  it('releases when focus leaves the button', () => {
    const setHeld = vi.fn();
    const hold = createHoldKey(['Enter'], setHeld);
    hold.keydown({ key: 'Enter', repeat: false, preventDefault: vi.fn() });
    hold.release();
    expect(setHeld).toHaveBeenLastCalledWith(false);
  });
});
