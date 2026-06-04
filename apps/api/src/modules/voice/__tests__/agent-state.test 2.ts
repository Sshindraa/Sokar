import { describe, it, expect } from 'vitest';
import { AgentStateMachine } from '../agent-state';

describe('AgentStateMachine', () => {
  it('démarre en IDLE', () => {
    const sm = new AgentStateMachine();
    expect(sm.current).toBe('IDLE');
    expect(sm.isSpeaking).toBe(false);
  });

  it('IDLE → LISTENING → PROCESSING → SPEAKING → LISTENING → IDLE', () => {
    const sm = new AgentStateMachine();
    expect(sm.transition('LISTENING')).toBe(true);
    expect(sm.current).toBe('LISTENING');
    expect(sm.transition('PROCESSING')).toBe(true);
    expect(sm.current).toBe('PROCESSING');
    expect(sm.transition('SPEAKING')).toBe(true);
    expect(sm.current).toBe('SPEAKING');
    expect(sm.isSpeaking).toBe(true);
    expect(sm.transition('LISTENING')).toBe(true);
    expect(sm.transition('IDLE')).toBe(true);
    expect(sm.current).toBe('IDLE');
  });

  it('rejette les transitions invalides', () => {
    const sm = new AgentStateMachine();
    expect(sm.transition('SPEAKING')).toBe(false); // IDLE → SPEAKING interdit
    expect(sm.current).toBe('IDLE');
  });

  it('notifie les listeners de transition', () => {
    const sm = new AgentStateMachine();
    const changes: string[] = [];
    sm.onTransition((from, to) => changes.push(`${from}→${to}`));
    sm.transition('LISTENING');
    sm.transition('PROCESSING');
    expect(changes).toEqual(['IDLE→LISTENING', 'LISTENING→PROCESSING']);
  });

  it('reset revient à IDLE', () => {
    const sm = new AgentStateMachine();
    sm.transition('LISTENING');
    sm.reset();
    expect(sm.current).toBe('IDLE');
  });
});
