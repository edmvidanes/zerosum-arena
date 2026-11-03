import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Account, ArenaTone, BankSummary, CombatFeedback, LeaderboardReport, MatchHistoryEntry, MatchSummary, PublicPlayer, QuestionPreview, ServerMessage, Snapshot, TournamentReport } from './types';

function createClientId() {
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();

  const bytes = new Uint8Array(16);
  if (typeof globalThis.crypto?.getRandomValues === 'function') globalThis.crypto.getRandomValues(bytes);
  else for (let index = 0; index < bytes.length; index += 1) bytes[index] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

const clientId = (() => {
  const existing = localStorage.getItem('zerosum-client');
  if (existing) return existing;
  const id = createClientId();
  localStorage.setItem('zerosum-client', id);
  return id;
})();

type LandingMode = 'choose' | 'join' | 'login' | 'host' | 'banks' | 'solo' | 'challenge';
type BankManagerView = 'library' | 'create' | 'import' | 'ai';
type DraftQuestion = {
  id: string;
  prompt: string;
  options: string[];
  correctIndex: number;
  explanation: string;
  difficulty: 'basic' | 'scenario';
};

const createDraftQuestion = (): DraftQuestion => ({
  id: createClientId(), prompt: '', options: ['', '', '', ''], correctIndex: 0, explanation: '', difficulty: 'basic',
});
const domainNames: Record<number, string> = { 1: 'Cloud Concepts', 2: 'Security & Compliance', 3: 'Technology & Services', 4: 'Billing, Pricing & Support' };
const questionLabel = (question: QuestionPreview) => question.domain ? (domainNames[question.domain] ?? `Domain ${question.domain}`) : question.type === 'TRUE_FALSE' ? 'True or false' : 'Multiple choice';
const fighterThemes = [
  { name: 'Inferno', gi: '#ff7a1a', giDark: '#c2410c', pants: '#2c3a5e', hair: '#3a2a1a', aura: '#ff9d3a', accent: '#ffd23e' },
  { name: 'Azure', gi: '#1f8fe0', giDark: '#075985', pants: '#22304d', hair: '#12283f', aura: '#37b8d3', accent: '#a5f3fc' },
  { name: 'Violet', gi: '#8b5cf6', giDark: '#5b21b6', pants: '#2a2440', hair: '#241335', aura: '#b967ff', accent: '#e9d5ff' },
  { name: 'Emerald', gi: '#22b573', giDark: '#15803d', pants: '#26332a', hair: '#1d2b1a', aura: '#7cfc00', accent: '#d9f99d' },
  { name: 'Crimson', gi: '#e63946', giDark: '#991b1b', pants: '#33262e', hair: '#2a1215', aura: '#ff4d6d', accent: '#fecdd3' },
  { name: 'Solar', gi: '#f5b921', giDark: '#b45309', pants: '#3a3049', hair: '#4a2c0a', aura: '#ffd23e', accent: '#fef3c7' },
  { name: 'Shadow', gi: '#64748b', giDark: '#1e293b', pants: '#111827', hair: '#0b0f16', aura: '#94a3b8', accent: '#e2e8f0' },
  { name: 'Rose', gi: '#ec4899', giDark: '#9d174d', pants: '#3b2436', hair: '#33101f', aura: '#ff8fb5', accent: '#ffe4f0' },
  { name: 'Frost', gi: '#7dd3fc', giDark: '#0369a1', pants: '#1e3a5f', hair: '#0f2536', aura: '#a5f3fc', accent: '#ffffff' },
  { name: 'Toxic', gi: '#a3e635', giDark: '#4d7c0f', pants: '#26331c', hair: '#1c2a10', aura: '#bef264', accent: '#ecfccb' },
  { name: 'Royal', gi: '#6366f1', giDark: '#3730a3', pants: '#27272a', hair: '#171233', aura: '#818cf8', accent: '#e0e7ff' },
  { name: 'Sunset', gi: '#fb923c', giDark: '#c2410c', pants: '#43302e', hair: '#33150f', aura: '#fdba74', accent: '#ffedd5' },
  { name: 'Ocean', gi: '#06b6d4', giDark: '#155e75', pants: '#17384a', hair: '#0a2530', aura: '#22d3ee', accent: '#cffafe' },
  { name: 'Sakura', gi: '#f9a8d4', giDark: '#be185d', pants: '#3f2a3a', hair: '#2f1220', aura: '#fbcfe8', accent: '#fff1f2' },
  { name: 'Onyx', gi: '#334155', giDark: '#0f172a', pants: '#020617', hair: '#000000', aura: '#cbd5e1', accent: '#f8fafc' },
  { name: 'Ivory', gi: '#e7e5e4', giDark: '#a8a29e', pants: '#44403c', hair: '#292524', aura: '#f5f5f4', accent: '#ffffff' },
  { name: 'Copper', gi: '#d97706', giDark: '#92400e', pants: '#3b2f2f', hair: '#2a1503', aura: '#fbbf24', accent: '#fef3c7' },
  { name: 'Jade', gi: '#2dd4bf', giDark: '#0f766e', pants: '#14332f', hair: '#0b2422', aura: '#5eead4', accent: '#ccfbf1' },
  { name: 'Storm', gi: '#38bdf8', giDark: '#1d4ed8', pants: '#1e293b', hair: '#0b1e33', aura: '#93c5fd', accent: '#dbeafe' },
  { name: 'Magma', gi: '#ef4444', giDark: '#7f1d1d', pants: '#290f0f', hair: '#1a0505', aura: '#f97316', accent: '#fee2e2' },
  { name: 'Mint', gi: '#6ee7b7', giDark: '#059669', pants: '#17352a', hair: '#0d211a', aura: '#a7f3d0', accent: '#ecfdf5' },
  { name: 'Grape', gi: '#c084fc', giDark: '#7e22ce', pants: '#2e1065', hair: '#1e1033', aura: '#d8b4fe', accent: '#faf5ff' },
  { name: 'Desert', gi: '#fbbf24', giDark: '#b45309', pants: '#574124', hair: '#3a2405', aura: '#fde68a', accent: '#fffbeb' },
  { name: 'Midnight', gi: '#818cf8', giDark: '#312e81', pants: '#111133', hair: '#080820', aura: '#a5b4fc', accent: '#eef2ff' },
  { name: 'Champion', gi: '#facc15', giDark: '#a16207', pants: '#713f12', hair: '#422006', aura: '#fde047', accent: '#ffffff' },
];
const variantNames = ['Fighter', 'Female Fighter', 'Werewolf', 'Robot', 'Alien', 'Skeleton'];
export const encodeAvatar = (variant: number, theme: number) => `arena-v${variant}t${String(theme + 1).padStart(2, '0')}`;
const playerAvatars = variantNames.flatMap((_, variant) => fighterThemes.map((_, theme) => encodeAvatar(variant, theme)));
export type SpritePose = 'idle' | 'charge' | 'attack' | 'hit' | 'block' | 'ko' | 'win';
export function parseAvatar(seed?: string): { variant: number; theme: number } {
  const custom = String(seed ?? '').match(/^arena-v([0-5])t(\d{1,2})$/);
  if (custom) return { variant: Number(custom[1]), theme: Math.min(24, Math.max(0, Number(custom[2]) - 1)) };
  const legacy = String(seed ?? '').match(/^arena-(\d{1,2})$/);
  if (legacy) return { variant: 0, theme: Math.min(24, Math.max(0, Number(legacy[1]) - 1)) };
  let hash = 0;
  for (const char of String(seed ?? 'F')) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return { variant: hash % variantNames.length, theme: hash % fighterThemes.length };
}
export const isValidAvatar = (seed?: string) => playerAvatars.includes(String(seed ?? '')) || /^arena-\d{1,2}$/.test(String(seed ?? ''));
export function fighterName(seed?: string) {
  const { variant, theme } = parseAvatar(seed);
  return `${fighterThemes[theme].name} ${variantNames[variant]}`;
}


const initialUrlCode = new URLSearchParams(location.search).get('code')?.toUpperCase() ?? '';
const savedHostToken = sessionStorage.getItem('zerosum-host-token') ?? '';
const savedHostCode = sessionStorage.getItem('zerosum-host-code') ?? '';
const canResumeHost = Boolean(initialUrlCode && savedHostToken && (!savedHostCode || savedHostCode === initialUrlCode));
const playerTokenKey = (gameCode: string) => `zerosum-player-token:${gameCode.trim().toUpperCase()}`;
const savedPlayerToken = (gameCode: string) => localStorage.getItem(playerTokenKey(gameCode)) ?? '';

function hpDisplay(hp: number) {
  return Array.from({ length: 3 }, (_, index) => index < hp ? '♥' : '♡').join(' ');
}

function formatCountdown(seconds: number) {
  const safe = Math.max(0, seconds);
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, '0')}`;
}

function playerName(players: PublicPlayer[], id: string) {
  return players.find((player) => player.id === id)?.name ?? 'Unknown player';
}

export function FighterAvatar({ seed, large = false, pose = 'idle' }: { seed?: string; large?: boolean; pose?: SpritePose }) {
  const { variant, theme: themeIdx } = parseAvatar(seed);
  const theme = fighterThemes[themeIdx];
  const ko = pose === 'ko';
  const bodyTransform = ko ? 'rotate(-82 110 196)' : pose === 'charge' ? 'translate(0 12)' : pose === 'hit' ? 'rotate(-9 110 130)' : pose === 'win' ? 'translate(0 -3)' : undefined;
  const skin = '#f0bd8d';
  const line = 'rgba(8,14,26,.38)';
  return <svg className={`fighter-avatar-svg pose-${pose} ${large ? 'large' : ''}`} viewBox="0 0 220 220" role="img" aria-label={`${theme.name} fighter`}>
    <ellipse className="arena-aura" cx="110" cy="112" rx="80" ry="90" fill={theme.aura} opacity="0.16" />
    <ellipse cx="110" cy="203" rx="60" ry="7" fill="#000000" opacity="0.35" />
    <g transform={bodyTransform}>
{variant === 2 && <path d="M86 148 Q48 162 42 124 Q56 144 86 136 Z" fill="#7d6a58" stroke={line} strokeWidth="2" />}
      {variant === 1 && <path d="M84 38 Q76 108 90 130 L130 130 Q144 108 136 38 Q110 58 84 38 Z" fill={theme.hair} stroke={line} strokeWidth="2" />}
      <path d="M100 128 L87 176 L101 176 L111 138 Z" fill={theme.pants} stroke={line} strokeWidth="2" />
      <path d="M119 128 L129 176 L143 176 L129 136 Z" fill={theme.pants} stroke={line} strokeWidth="2" />
      <rect x="82" y="174" width="23" height="11" rx="4" fill={theme.giDark} />
      <rect x="124" y="174" width="23" height="11" rx="4" fill={theme.giDark} />
      {pose === 'idle' || ko ? <><path d="M86 84 L66 114 L77 121 L93 95 Z" fill={theme.gi} stroke={line} strokeWidth="2" /><circle cx="71" cy="119" r="7.5" fill={skin} stroke={line} strokeWidth="2" /></> : null}
      {pose === 'hit' && <><path d="M86 82 L61 57 L69 48 L95 71 Z" fill={theme.gi} stroke={line} strokeWidth="2" /><circle cx="65" cy="52" r="7.5" fill={skin} stroke={line} strokeWidth="2" /></>}
      {pose === 'charge' && <path d="M87 86 L118 107 L112 119 L81 97 Z" fill={theme.giDark} stroke={line} strokeWidth="2" />}
      {pose === 'attack' && <path d="M87 83 L148 91 L147 103 L85 95 Z" fill={theme.giDark} stroke={line} strokeWidth="2" />}
      {pose === 'block' && <path d="M90 79 L140 107 L133 119 L83 91 Z" fill={theme.giDark} stroke={line} strokeWidth="2" />}
      {pose === 'win' && <path d="M86 84 L66 114 L77 121 L93 95 Z" fill={theme.gi} stroke={line} strokeWidth="2" />}
      {pose === 'win' && <circle cx="71" cy="119" r="7.5" fill={skin} stroke={line} strokeWidth="2" />}
      <path d="M84 76 Q110 64 136 76 L143 132 Q110 143 77 132 Z" fill={theme.gi} stroke={line} strokeWidth="2" />
      <path d="M97 69 L110 97 L123 69 L123 82 L110 106 L97 82 Z" fill={theme.giDark} />
      <rect x="79" y="124" width="62" height="11" rx="4" fill={theme.accent} stroke={line} strokeWidth="1.5" />
      <path d="M128 135 L138 152 L130 154 L122 137 Z" fill={theme.accent} />
{variant <= 1 && <>
      <circle cx="110" cy="47" r="25" fill={skin} stroke={line} strokeWidth="2" />
      {variant === 0 && <>
        <path d="M85 50 L77 25 L92 31 L94 12 L107 27 L115 8 L123 27 L135 16 L133 35 L141 31 L135 53 Q110 37 85 50 Z" fill={theme.hair} stroke={line} strokeWidth="2" strokeLinejoin="round" />
        <path d="M86 39 Q110 31 134 39 L134 47 Q110 39 86 47 Z" fill={theme.accent} />
        <path d="M86 43 L72 51 L83 56 Z" fill={theme.accent} />
      </>}
      {variant === 1 && <>
        <path d="M132 26 Q154 36 150 64 Q141 50 129 42 Z" fill={theme.hair} stroke={line} strokeWidth="2" />
        <path d="M84 50 Q80 18 110 16 Q140 18 136 50 Q134 34 124 30 Q128 44 124 48 Q118 32 104 32 Q90 34 86 50 Z" fill={theme.hair} stroke={line} strokeWidth="2" strokeLinejoin="round" />
        <path d="M87 37 Q110 30 133 37 L133 44 Q110 37 87 44 Z" fill={theme.accent} />
        <ellipse cx="94" cy="58" rx="4.5" ry="2.6" fill="#ff9db1" opacity="0.55" />
        <ellipse cx="128" cy="58" rx="4.5" ry="2.6" fill="#ff9db1" opacity="0.55" />
      </>}
      {ko ? <>
        <path d="M98 47 L107 56 M107 47 L98 56" stroke="#1f2430" strokeWidth="2.6" strokeLinecap="round" />
        <path d="M116 47 L125 56 M125 47 L116 56" stroke="#1f2430" strokeWidth="2.6" strokeLinecap="round" />
        <path d="M106 64 Q113 60 120 64" fill="none" stroke="#1f2430" strokeWidth="2.2" strokeLinecap="round" />
      </> : pose === 'win' ? <>
        <path d="M98 52 Q103 47 108 52 M116 52 Q121 47 126 52" fill="none" stroke="#1f2430" strokeWidth="2.4" strokeLinecap="round" />
        <path d="M105 59 Q113 67 121 59 Q113 63 105 59 Z" fill="#7c2d12" />
      </> : pose === 'hit' ? <>
        <ellipse cx="103" cy="51" rx="3.4" ry="5" fill="#1f2430" /><ellipse cx="122" cy="51" rx="3.4" ry="5" fill="#1f2430" />
        <circle cx="113" cy="62" r="4" fill="#7c2d12" />
      </> : <>
        <ellipse cx="103" cy="52" rx="3" ry="4.4" fill="#1f2430" /><ellipse cx="122" cy="52" rx="3" ry="4.4" fill="#1f2430" />
        {variant === 1 && <path d="M97 48 L92 44 M127 48 L132 44" stroke="#1f2430" strokeWidth="2" strokeLinecap="round" />}
        <path d="M96 44 L108 47 M128 44 L116 47" stroke="#1f2430" strokeWidth="2.4" strokeLinecap="round" />
        <path d="M107 61 Q113 64 119 61" fill="none" stroke="#1f2430" strokeWidth="2.2" strokeLinecap="round" />
      </>}
    </>}
    {variant === 2 && <>
      <path d="M89 31 L84 6 L104 19 Z" fill="#7d6a58" stroke={line} strokeWidth="2" strokeLinejoin="round" />
      <path d="M131 31 L136 6 L116 19 Z" fill="#7d6a58" stroke={line} strokeWidth="2" strokeLinejoin="round" />
      <path d="M92 26 L90 14 L100 21 Z M128 26 L130 14 L120 21 Z" fill="#d9a08a" />
      <circle cx="110" cy="47" r="25" fill="#8a7663" stroke={line} strokeWidth="2" />
      <path d="M86 50 L74 57 L87 62 M134 50 L146 57 L133 62" fill="#8a7663" stroke={line} strokeWidth="1.6" />
      <ellipse cx="117" cy="57" rx="14" ry="9.5" fill="#d8c3a5" stroke={line} strokeWidth="1.6" />
      <ellipse cx="125" cy="52" rx="5.5" ry="4.2" fill="#2b2118" />
      <path d="M108 63 L111 70 L114 63 M119 64 L122 71 L125 64" fill="#ffffff" stroke={line} strokeWidth="1" />
      <ellipse cx="101" cy="45" rx="3.6" ry="4.6" fill="#ffb020" /><ellipse cx="120" cy="45" rx="3.6" ry="4.6" fill="#ffb020" />
      <circle cx="101" cy="45" r="1.7" fill="#1f1508" /><circle cx="120" cy="45" r="1.7" fill="#1f1508" />
      <path d="M94 36 L106 39 M127 36 L115 39" stroke="#4a3a28" strokeWidth="2.4" strokeLinecap="round" />
    </>}
    {variant === 3 && <>
      <rect x="102" y="70" width="16" height="9" fill="#8fa2b8" stroke={line} strokeWidth="1.6" />
      <rect x="77" y="40" width="8" height="17" rx="3.5" fill={theme.giDark} stroke={line} strokeWidth="1.6" />
      <rect x="135" y="40" width="8" height="17" rx="3.5" fill={theme.giDark} stroke={line} strokeWidth="1.6" />
      <line x1="110" y1="23" x2="110" y2="11" stroke="#8fa2b8" strokeWidth="3" />
      <circle cx="110" cy="8" r="4.5" fill={theme.accent} stroke={line} strokeWidth="1.6" />
      <rect x="84" y="21" width="52" height="52" rx="13" fill="#b8c4d4" stroke={line} strokeWidth="2" />
      <rect x="91" y="38" width="38" height="14" rx="7" fill="#0b1220" />
      <circle cx="103" cy="45" r="3.6" fill={ko || pose === 'hit' ? '#ff5555' : theme.aura} />
      <circle cx="117" cy="45" r="3.6" fill={ko || pose === 'hit' ? '#ff5555' : theme.aura} />
      <rect x="101" y="61" width="18" height="4.5" rx="2.2" fill="#0b1220" opacity="0.65" />
      <path d="M92 28 L128 28" stroke="#8fa2b8" strokeWidth="2" />
    </>}
    {variant === 4 && <>
      <path d="M101 24 Q95 9 85 6" fill="none" stroke="#5da86e" strokeWidth="3" strokeLinecap="round" />
      <path d="M119 24 Q125 9 135 6" fill="none" stroke="#5da86e" strokeWidth="3" strokeLinecap="round" />
      <circle cx="84" cy="6" r="4.5" fill={theme.aura} stroke={line} strokeWidth="1.4" />
      <circle cx="136" cy="6" r="4.5" fill={theme.aura} stroke={line} strokeWidth="1.4" />
      <ellipse cx="110" cy="47" rx="26" ry="28" fill="#7ed491" stroke={line} strokeWidth="2" />
      <ellipse cx="100" cy="46" rx="6" ry="10.5" fill="#10231a" transform="rotate(-8 100 46)" />
      <ellipse cx="121" cy="46" rx="6" ry="10.5" fill="#10231a" transform="rotate(8 121 46)" />
      <circle cx="98" cy="42" r="2" fill="#d9ffe2" opacity="0.85" /><circle cx="119" cy="42" r="2" fill="#d9ffe2" opacity="0.85" />
      <path d="M105 63 Q110 66 116 63" fill="none" stroke="#14532d" strokeWidth="2.2" strokeLinecap="round" />
      <ellipse cx="92" cy="58" rx="4" ry="2.4" fill="#5da86e" opacity="0.5" /><ellipse cx="129" cy="58" rx="4" ry="2.4" fill="#5da86e" opacity="0.5" />
    </>}
    {variant === 5 && <>
      <path d="M86 47 Q84 19 110 19 Q136 19 134 47 Q134 61 125 66 L125 75 L95 75 L95 66 Q86 61 86 47 Z" fill="#eef1f4" stroke={line} strokeWidth="2" />
      <ellipse cx="100" cy="46" rx="7" ry="9" fill="#171310" /><ellipse cx="121" cy="46" rx="7" ry="9" fill="#171310" />
      <circle cx="100" cy="47" r="2.1" fill={theme.aura} /><circle cx="121" cy="47" r="2.1" fill={theme.aura} />
      <path d="M110 53 L105.5 62 L114.5 62 Z" fill="#171310" />
      <path d="M99 68 L99 75 M106 69 L106 75 M113 69 L113 75 M120 68 L120 75" stroke="#8b93a0" strokeWidth="2" />
      <path d="M94 27 Q100 23 106 25" fill="none" stroke="#b9c0cb" strokeWidth="2" strokeLinecap="round" />
    </>}
      {pose === 'idle' || ko ? <><path d="M134 84 L153 111 L143 119 L126 95 Z" fill={theme.gi} stroke={line} strokeWidth="2" /><circle cx="149" cy="115" r="7.5" fill={skin} stroke={line} strokeWidth="2" /></> : null}
      {pose === 'hit' && <><path d="M134 82 L159 55 L167 63 L143 90 Z" fill={theme.gi} stroke={line} strokeWidth="2" /><circle cx="163" cy="59" r="7.5" fill={skin} stroke={line} strokeWidth="2" /></>}
      {pose === 'charge' && <><path d="M133 83 L157 102 L149 114 L125 96 Z" fill={theme.gi} stroke={line} strokeWidth="2" /><circle cx="153" cy="108" r="7.5" fill={skin} stroke={line} strokeWidth="2" /><circle className="charge-orb" cx="163" cy="110" r="14" fill={theme.aura} opacity="0.85" /><circle cx="163" cy="110" r="6" fill="#ffffff" opacity="0.9" /></>}
      {pose === 'attack' && <><path d="M133 79 L173 76 L175 88 L131 93 Z" fill={theme.gi} stroke={line} strokeWidth="2" /><circle cx="176" cy="82" r="7.5" fill={skin} stroke={line} strokeWidth="2" /><g className="fighter-beam"><rect x="180" y="70" width="38" height="24" rx="12" fill={theme.aura} opacity="0.85" /><rect x="182" y="77" width="34" height="10" rx="5" fill="#ffffff" opacity="0.85" /></g></>}
      {pose === 'block' && <><path d="M136 79 L88 109 L95 121 L143 91 Z" fill={theme.gi} stroke={line} strokeWidth="2" /><path d="M152 58 Q182 108 152 160 Q164 108 152 58 Z" fill={theme.accent} opacity="0.28" stroke={theme.aura} strokeWidth="2.5" /></>}
      {pose === 'win' && <><path d="M134 81 L155 46 L165 53 L145 89 Z" fill={theme.gi} stroke={line} strokeWidth="2" /><circle cx="161" cy="50" r="8" fill={skin} stroke={line} strokeWidth="2" /><path d="M168 22 L171 30 L179 30 L173 35 L175 43 L168 38 L161 43 L163 35 L157 30 L165 30 Z" fill={theme.accent} /></>}
    </g>
  </svg>;
}

function fighterSvgMarkup(seed?: string, pose: 'idle' | 'ko' = 'idle'): string {
  const { variant, theme: themeIdx } = parseAvatar(seed);
  const theme = fighterThemes[themeIdx];
  const skin = '#f0bd8d';
  const line = 'rgba(8,14,26,.38)';
  const parts: string[] = [
    `<svg viewBox="0 0 220 220" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${theme.name} fighter">`,
    `<ellipse cx="110" cy="112" rx="80" ry="90" fill="${theme.aura}" opacity="0.16"/>`,
    `<ellipse cx="110" cy="203" rx="60" ry="7" fill="#000000" opacity="0.35"/>`,
    pose === 'ko' ? '<g transform="rotate(-82 110 196)">' : '<g>',
  ];
  if (variant === 2) parts.push(`<path d="M86 148 Q48 162 42 124 Q56 144 86 136 Z" fill="#7d6a58" stroke="${line}" stroke-width="2"/>`);
  if (variant === 1) parts.push(`<path d="M84 38 Q76 108 90 130 L130 130 Q144 108 136 38 Q110 58 84 38 Z" fill="${theme.hair}" stroke="${line}" stroke-width="2"/>`);
  parts.push(`<path d="M100 128 L87 176 L101 176 L111 138 Z" fill="${theme.pants}" stroke="${line}" stroke-width="2"/>`);
  parts.push(`<path d="M119 128 L129 176 L143 176 L129 136 Z" fill="${theme.pants}" stroke="${line}" stroke-width="2"/>`);
  parts.push(`<rect x="82" y="174" width="23" height="11" rx="4" fill="${theme.giDark}"/><rect x="124" y="174" width="23" height="11" rx="4" fill="${theme.giDark}"/>`);
  parts.push(`<path d="M86 84 L66 114 L77 121 L93 95 Z" fill="${theme.gi}" stroke="${line}" stroke-width="2"/><circle cx="71" cy="119" r="7.5" fill="${skin}" stroke="${line}" stroke-width="2"/>`);
  parts.push(`<path d="M84 76 Q110 64 136 76 L143 132 Q110 143 77 132 Z" fill="${theme.gi}" stroke="${line}" stroke-width="2"/>`);
  parts.push(`<path d="M97 69 L110 97 L123 69 L123 82 L110 106 L97 82 Z" fill="${theme.giDark}"/>`);
  parts.push(`<rect x="79" y="124" width="62" height="11" rx="4" fill="${theme.accent}" stroke="${line}" stroke-width="1.5"/><path d="M128 135 L138 152 L130 154 L122 137 Z" fill="${theme.accent}"/>`);
  if (variant <= 1) {
    parts.push(`<circle cx="110" cy="47" r="25" fill="${skin}" stroke="${line}" stroke-width="2"/>`);
    if (variant === 0) {
      parts.push(`<path d="M85 50 L77 25 L92 31 L94 12 L107 27 L115 8 L123 27 L135 16 L133 35 L141 31 L135 53 Q110 37 85 50 Z" fill="${theme.hair}" stroke="${line}" stroke-width="2" stroke-linejoin="round"/>`);
      parts.push(`<path d="M86 39 Q110 31 134 39 L134 47 Q110 39 86 47 Z" fill="${theme.accent}"/><path d="M86 43 L72 51 L83 56 Z" fill="${theme.accent}"/>`);
    } else {
      parts.push(`<path d="M132 26 Q154 36 150 64 Q141 50 129 42 Z" fill="${theme.hair}" stroke="${line}" stroke-width="2"/>`);
      parts.push(`<path d="M84 50 Q80 18 110 16 Q140 18 136 50 Q134 34 124 30 Q128 44 124 48 Q118 32 104 32 Q90 34 86 50 Z" fill="${theme.hair}" stroke="${line}" stroke-width="2" stroke-linejoin="round"/>`);
      parts.push(`<path d="M87 37 Q110 30 133 37 L133 44 Q110 37 87 44 Z" fill="${theme.accent}"/>`);
      parts.push(`<ellipse cx="94" cy="58" rx="4.5" ry="2.6" fill="#ff9db1" opacity="0.55"/><ellipse cx="128" cy="58" rx="4.5" ry="2.6" fill="#ff9db1" opacity="0.55"/>`);
    }
    if (pose === 'ko') {
      parts.push(`<path d="M98 47 L107 56 M107 47 L98 56" stroke="#1f2430" stroke-width="2.6" stroke-linecap="round"/><path d="M116 47 L125 56 M125 47 L116 56" stroke="#1f2430" stroke-width="2.6" stroke-linecap="round"/>`);
      parts.push(`<path d="M106 64 Q113 60 120 64" fill="none" stroke="#1f2430" stroke-width="2.2" stroke-linecap="round"/>`);
    } else {
      parts.push(`<ellipse cx="103" cy="52" rx="3" ry="4.4" fill="#1f2430"/><ellipse cx="122" cy="52" rx="3" ry="4.4" fill="#1f2430"/>`);
      if (variant === 1) parts.push(`<path d="M97 48 L92 44 M127 48 L132 44" stroke="#1f2430" stroke-width="2" stroke-linecap="round"/>`);
      parts.push(`<path d="M96 44 L108 47 M128 44 L116 47" stroke="#1f2430" stroke-width="2.4" stroke-linecap="round"/>`);
      parts.push(`<path d="M107 61 Q113 64 119 61" fill="none" stroke="#1f2430" stroke-width="2.2" stroke-linecap="round"/>`);
    }
  }
  if (variant === 2) {
    parts.push(`<path d="M89 31 L84 6 L104 19 Z" fill="#7d6a58" stroke="${line}" stroke-width="2" stroke-linejoin="round"/><path d="M131 31 L136 6 L116 19 Z" fill="#7d6a58" stroke="${line}" stroke-width="2" stroke-linejoin="round"/>`);
    parts.push(`<path d="M92 26 L90 14 L100 21 Z M128 26 L130 14 L120 21 Z" fill="#d9a08a"/>`);
    parts.push(`<circle cx="110" cy="47" r="25" fill="#8a7663" stroke="${line}" stroke-width="2"/>`);
    parts.push(`<path d="M86 50 L74 57 L87 62 M134 50 L146 57 L133 62" fill="#8a7663" stroke="${line}" stroke-width="1.6"/>`);
    parts.push(`<ellipse cx="117" cy="57" rx="14" ry="9.5" fill="#d8c3a5" stroke="${line}" stroke-width="1.6"/><ellipse cx="125" cy="52" rx="5.5" ry="4.2" fill="#2b2118"/>`);
    parts.push(`<path d="M108 63 L111 70 L114 63 M119 64 L122 71 L125 64" fill="#ffffff" stroke="${line}" stroke-width="1"/>`);
    parts.push(`<ellipse cx="101" cy="45" rx="3.6" ry="4.6" fill="#ffb020"/><ellipse cx="120" cy="45" rx="3.6" ry="4.6" fill="#ffb020"/><circle cx="101" cy="45" r="1.7" fill="#1f1508"/><circle cx="120" cy="45" r="1.7" fill="#1f1508"/>`);
    parts.push(`<path d="M94 36 L106 39 M127 36 L115 39" stroke="#4a3a28" stroke-width="2.4" stroke-linecap="round"/>`);
  }
  if (variant === 3) {
    parts.push(`<rect x="102" y="70" width="16" height="9" fill="#8fa2b8" stroke="${line}" stroke-width="1.6"/><rect x="77" y="40" width="8" height="17" rx="3.5" fill="${theme.giDark}" stroke="${line}" stroke-width="1.6"/><rect x="135" y="40" width="8" height="17" rx="3.5" fill="${theme.giDark}" stroke="${line}" stroke-width="1.6"/>`);
    parts.push(`<line x1="110" y1="23" x2="110" y2="11" stroke="#8fa2b8" stroke-width="3"/><circle cx="110" cy="8" r="4.5" fill="${theme.accent}" stroke="${line}" stroke-width="1.6"/>`);
    parts.push(`<rect x="84" y="21" width="52" height="52" rx="13" fill="#b8c4d4" stroke="${line}" stroke-width="2"/><rect x="91" y="38" width="38" height="14" rx="7" fill="#0b1220"/>`);
    parts.push(`<circle cx="103" cy="45" r="3.6" fill="${pose === 'ko' ? '#ff5555' : theme.aura}"/><circle cx="117" cy="45" r="3.6" fill="${pose === 'ko' ? '#ff5555' : theme.aura}"/><rect x="101" y="61" width="18" height="4.5" rx="2.2" fill="#0b1220" opacity="0.65"/>`);
    parts.push(`<path d="M92 28 L128 28" stroke="#8fa2b8" stroke-width="2"/>`);
  }
  if (variant === 4) {
    parts.push(`<path d="M101 24 Q95 9 85 6" fill="none" stroke="#5da86e" stroke-width="3" stroke-linecap="round"/><path d="M119 24 Q125 9 135 6" fill="none" stroke="#5da86e" stroke-width="3" stroke-linecap="round"/>`);
    parts.push(`<circle cx="84" cy="6" r="4.5" fill="${theme.aura}" stroke="${line}" stroke-width="1.4"/><circle cx="136" cy="6" r="4.5" fill="${theme.aura}" stroke="${line}" stroke-width="1.4"/>`);
    parts.push(`<ellipse cx="110" cy="47" rx="26" ry="28" fill="#7ed491" stroke="${line}" stroke-width="2"/>`);
    parts.push(`<ellipse cx="100" cy="46" rx="6" ry="10.5" fill="#10231a" transform="rotate(-8 100 46)"/><ellipse cx="121" cy="46" rx="6" ry="10.5" fill="#10231a" transform="rotate(8 121 46)"/>`);
    parts.push(`<circle cx="98" cy="42" r="2" fill="#d9ffe2" opacity="0.85"/><circle cx="119" cy="42" r="2" fill="#d9ffe2" opacity="0.85"/>`);
    parts.push(`<path d="M105 63 Q110 66 116 63" fill="none" stroke="#14532d" stroke-width="2.2" stroke-linecap="round"/>`);
    parts.push(`<ellipse cx="92" cy="58" rx="4" ry="2.4" fill="#5da86e" opacity="0.5"/><ellipse cx="129" cy="58" rx="4" ry="2.4" fill="#5da86e" opacity="0.5"/>`);
  }
  if (variant === 5) {
    parts.push(`<path d="M86 47 Q84 19 110 19 Q136 19 134 47 Q134 61 125 66 L125 75 L95 75 L95 66 Q86 61 86 47 Z" fill="#eef1f4" stroke="${line}" stroke-width="2"/>`);
    parts.push(`<ellipse cx="100" cy="46" rx="7" ry="9" fill="#171310"/><ellipse cx="121" cy="46" rx="7" ry="9" fill="#171310"/><circle cx="100" cy="47" r="2.1" fill="${theme.aura}"/><circle cx="121" cy="47" r="2.1" fill="${theme.aura}"/>`);
    parts.push(`<path d="M110 53 L105.5 62 L114.5 62 Z" fill="#171310"/><path d="M99 68 L99 75 M106 69 L106 75 M113 69 L113 75 M120 68 L120 75" stroke="#8b93a0" stroke-width="2"/>`);
    parts.push(`<path d="M94 27 Q100 23 106 25" fill="none" stroke="#b9c0cb" stroke-width="2" stroke-linecap="round"/>`);
  }
  parts.push(`<path d="M134 84 L153 111 L143 119 L126 95 Z" fill="${theme.gi}" stroke="${line}" stroke-width="2"/><circle cx="149" cy="115" r="7.5" fill="${skin}" stroke="${line}" stroke-width="2"/>`);
  parts.push('</g></svg>');
  return parts.join('');
}

function FighterThemePicker({ current, onApply }: { current: string; onApply: (avatar: string) => void }) {
  const [draft, setDraft] = useState(isValidAvatar(current) ? current : playerAvatars[0]);
  const { variant, theme } = parseAvatar(draft);
  const randomize = () => { setDraft(playerAvatars[Math.floor(Math.random() * playerAvatars.length)]); playSfx('click'); };
  return <div className="theme-picker">
    <div className="builder-preview"><FighterAvatar seed={draft} large /><strong>{fighterName(draft)}</strong><small>One fighter family — pick a variant and colors</small></div>
    <div><span className="picker-label">Variant</span><div className="avatar-grid variant-grid">{variantNames.map((label, v) => <button type="button" key={label} aria-label={`Variant ${label}`} aria-pressed={variant === v} className={variant === v ? 'selected' : ''} onClick={() => { setDraft(encodeAvatar(v, theme)); playSfx('click'); }}><FighterAvatar seed={encodeAvatar(v, theme)} /><span className="fighter-name">{label}</span></button>)}</div></div>
    <div><span className="picker-label">Color theme</span><div className="avatar-grid theme-grid">{fighterThemes.map((choice, i) => <button type="button" key={choice.name} aria-label={`Theme ${choice.name}`} aria-pressed={theme === i} className={theme === i ? 'selected' : ''} onClick={() => { setDraft(encodeAvatar(variant, i)); playSfx('click'); }}><FighterAvatar seed={encodeAvatar(variant, i)} /><span className="fighter-name">{choice.name}</span></button>)}</div></div>
    <div className="builder-row theme-actions"><button type="button" className="builder-random" onClick={randomize}>🎲 Randomize</button><button type="button" className="builder-apply" onClick={() => onApply(draft)}>Use this fighter</button></div>
  </div>;
}

let sfxContext: AudioContext | null = null;
let sfxNoise: AudioBuffer | null = null;
let chargeNodes: { osc: OscillatorNode; gain: GainNode } | null = null;
const sfxOn = () => localStorage.getItem('zerosum-sfx') !== 'off';
function sfxCtx() {
  if (!sfxContext) {
    sfxContext = new AudioContext();
    sfxNoise = sfxContext.createBuffer(1, sfxContext.sampleRate, sfxContext.sampleRate);
    const data = sfxNoise.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
  }
  if (sfxContext.state === 'suspended') void sfxContext.resume();
  return sfxContext;
}
function sfxTone(freqFrom: number, freqTo: number, seconds: number, type: OscillatorType, volume: number, delay = 0) {
  const context = sfxCtx(); const at = context.currentTime + delay;
  const osc = context.createOscillator(); const gain = context.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freqFrom, at);
  osc.frequency.exponentialRampToValueAtTime(Math.max(30, freqTo), at + seconds);
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.exponentialRampToValueAtTime(volume, at + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + seconds);
  osc.connect(gain).connect(context.destination); osc.start(at); osc.stop(at + seconds + 0.05);
}
function sfxNoiseBurst(seconds: number, volume: number, filterFreq: number, delay = 0) {
  const context = sfxCtx(); if (!sfxNoise) return; const at = context.currentTime + delay;
  const src = context.createBufferSource(); src.buffer = sfxNoise; src.loop = true;
  const filter = context.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = filterFreq;
  const gain = context.createGain();
  gain.gain.setValueAtTime(volume, at);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + seconds);
  src.connect(filter).connect(gain).connect(context.destination); src.start(at); src.stop(at + seconds + 0.05);
}
export function stopChargeSfx() {
  if (!chargeNodes || !sfxContext) { chargeNodes = null; return; }
  const nodes = chargeNodes;
  chargeNodes = null;
  try {
    const now = sfxContext.currentTime;
    nodes.gain.gain.cancelScheduledValues(now);
    nodes.gain.gain.setValueAtTime(Math.max(nodes.gain.gain.value, 0.0001), now);
    nodes.gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.08);
    nodes.osc.stop(now + 0.1);
    window.setTimeout(() => { try { nodes.osc.disconnect(); nodes.gain.disconnect(); } catch { /* already gone */ } }, 200);
  } catch { /* already stopped */ }
}
export function playSfx(kind: 'click' | 'charge' | 'beam' | 'impact' | 'explosion' | 'shield' | 'clash' | 'win' | 'lose' | 'beep') {
  if (!sfxOn()) return;
  try {
    if (kind === 'click') sfxTone(660, 520, 0.07, 'square', 0.06);
    if (kind === 'beep') sfxTone(880, 880, 0.12, 'square', 0.09);
    if (kind === 'charge') {
      stopChargeSfx();
      const context = sfxCtx();
      const osc = context.createOscillator(); const gain = context.createGain();
      osc.type = 'sawtooth'; osc.frequency.setValueAtTime(48, context.currentTime);
      osc.frequency.linearRampToValueAtTime(96, context.currentTime + 2.5);
      gain.gain.setValueAtTime(0.045, context.currentTime);
      osc.connect(gain).connect(context.destination); osc.start();
      chargeNodes = { osc, gain };
      // Safety: a charge must never outlive the round. Self-stop after 3.5s
      // even if combat feedback / game-end cleanup never fires.
      gain.gain.setValueAtTime(0.045, context.currentTime + 3.1);
      gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 3.45);
      osc.stop(context.currentTime + 3.5);
      osc.onended = () => { if (chargeNodes?.osc === osc) chargeNodes = null; };
      sfxTone(220, 990, 0.4, 'sawtooth', 0.05);
    }
    if (kind === 'beam') { sfxTone(1400, 160, 0.5, 'sawtooth', 0.16); sfxNoiseBurst(0.45, 0.12, 3200); }
    if (kind === 'impact') { sfxTone(110, 38, 0.3, 'sine', 0.3); sfxNoiseBurst(0.18, 0.16, 900); }
    if (kind === 'explosion') { sfxTone(160, 30, 0.8, 'sine', 0.34); sfxNoiseBurst(0.7, 0.2, 700); }
    if (kind === 'shield') { sfxTone(820, 1240, 0.22, 'triangle', 0.14); sfxTone(1240, 1640, 0.3, 'triangle', 0.1, 0.08); }
    if (kind === 'clash') { sfxTone(1400, 160, 0.5, 'sawtooth', 0.14); sfxTone(1200, 140, 0.5, 'sawtooth', 0.12, 0.05); sfxNoiseBurst(0.6, 0.18, 1600, 0.12); }
    if (kind === 'win') [523, 659, 784, 1047].forEach((freq, i) => sfxTone(freq, freq, 0.22, 'square', 0.1, i * 0.09));
    if (kind === 'lose') [392, 330, 262, 196].forEach((freq, i) => sfxTone(freq, freq * 0.94, 0.25, 'triangle', 0.11, i * 0.11));
  } catch { /* audio unavailable */ }
}

function PlayerAvatar({ player, large = false, hit = false }: { player?: PublicPlayer; large?: boolean; hit?: boolean }) {
  const hp = player?.hp ?? 3;
  return <span className={`player-avatar hp-${hp} ${large ? 'large' : ''} ${hit ? 'hit' : ''}`} aria-label={`${player?.name ?? 'Player'} avatar, ${hp} HP`}>
    <FighterAvatar seed={player?.avatar ?? 'arena-01'} large={large} pose={hp === 0 ? 'ko' : hit ? 'hit' : 'idle'} />
    {hp < 3 && <i aria-hidden="true">{hp === 0 ? '✕' : '⚡'}</i>}
  </span>;
}

function DamageOverlay({ amount, player }: { amount: number; player?: PublicPlayer }) {
  return <div className="damage-overlay" role="status" aria-live="assertive">
    <div className="damage-impact"><PlayerAvatar player={player} large hit /><strong>−{amount} HP</strong><span>YOU TOOK DAMAGE!</span></div>
  </div>;
}

const skillNames = ['SCHOLAR BEAM', 'MIND CANNON', 'EXAM FLASH', 'KNOWLEDGE WAVE', 'FOCUS BLAST'];

function FighterSprite({ player, side, state }: { player?: PublicPlayer; side: 'left' | 'right'; state: string }) {
  const pose: SpritePose = (player?.hp ?? 1) <= 0 ? 'ko' : state === 'attacking' ? 'attack' : state === 'hit' ? 'hit' : state === 'charging' ? 'charge' : 'idle';
  return <div className={`fighter ${side} ${state}`}>
    <div className="fighter-aura" aria-hidden="true"><i /><i /><i /></div>
    <div className="fighter-body" aria-hidden="true"><FighterAvatar seed={player?.avatar ?? 'arena-01'} large pose={pose} /></div>
    <div className="fighter-shadow" aria-hidden="true" />
    <div className="fighter-plate"><small>{side === 'left' ? 'YOU' : 'RIVAL'}</small><b>{player?.name ?? 'Unknown'}</b><strong>{hpDisplay(player?.hp ?? 0)}</strong></div>
  </div>;
}

function BattleStage({ me, opponents, combat, charging, gameMode }: {
  me?: PublicPlayer; opponents: PublicPlayer[]; combat?: CombatFeedback; charging: boolean; gameMode: 'QUIZ' | 'RPS';
}) {
  const [fx, setFx] = useState<{ key: string; kind: 'attack' | 'hit' | 'clash' | 'blocked'; skill: string }>();
  useEffect(() => {
    if (!combat || !me) return;
    const meDamaged = combat.damagedIds.includes(me.id);
    const rivalDamaged = opponents.some((opponent) => combat.damagedIds.includes(opponent.id));
    const kind = meDamaged && rivalDamaged ? 'clash' : rivalDamaged ? 'attack' : meDamaged ? 'hit' : 'blocked';
    setFx({ key: combat.key, kind, skill: skillNames[(combat.questionNumber - 1 + skillNames.length) % skillNames.length] });
    stopChargeSfx();
    if (kind === 'attack' || kind === 'hit') { playSfx('beam'); window.setTimeout(() => playSfx('impact'), 320); }
    else if (kind === 'clash') playSfx('clash');
    else playSfx('shield');
    if (combat.eliminatedIds.includes(me.id)) window.setTimeout(() => { playSfx('explosion'); playSfx('lose'); }, 500);
    else if (opponents.some((opponent) => combat.eliminatedIds.includes(opponent.id))) window.setTimeout(() => { playSfx('explosion'); playSfx('win'); }, 500);
    const timer = window.setTimeout(() => setFx((current) => current?.key === combat.key ? undefined : current), 1750);
    return () => window.clearTimeout(timer);
  }, [combat?.key]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => stopChargeSfx(), []);

  const myState = fx?.kind === 'attack' ? 'attacking' : fx?.kind === 'hit' || fx?.kind === 'clash' ? 'hit' : charging ? 'charging' : 'idle';
  const rivalState = fx?.kind === 'attack' || fx?.kind === 'clash' ? 'hit' : fx?.kind === 'hit' ? 'attacking' : 'idle';
  return <section className={`battle-stage fx-${fx?.kind ?? 'none'} ${charging && !fx ? 'is-charging' : ''}`} aria-label="Battle arena">
    <div className="stage-sky" aria-hidden="true"><i /><i /><i /></div>
    <div className="stage-ground" aria-hidden="true" />
    <FighterSprite player={me} side="left" state={myState} />
    <div className="stage-center" aria-hidden="true">
      {fx?.kind === 'attack' && <><div className="beam beam-right" /><div className="beam-impact right" /><div className="skill-banner">{fx.skill}!</div></>}
      {fx?.kind === 'hit' && <><div className="beam beam-left" /><div className="beam-impact left" /><div className="skill-banner danger">RIVAL {fx.skill}!</div></>}
      {fx?.kind === 'clash' && <><div className="beam beam-right half" /><div className="beam beam-left half" /><div className="clash-burst" /><div className="skill-banner clash">CLASH!</div></>}
      {fx?.kind === 'blocked' && <div className="skill-banner blocked">BLOCKED — NO DAMAGE</div>}
      {!fx && <span className="stage-vs">{charging ? '⚡' : 'VS'}</span>}
    </div>
    <div className="stage-rivals">{opponents.map((opponent) => <FighterSprite key={opponent.id} player={opponent} side="right" state={rivalState} />)}</div>
    <div className="stage-caption">{fx ? (fx.kind === 'attack' ? `Direct hit! Your ${gameMode === 'RPS' ? 'move' : 'answer'} dealt 1 damage.` : fx.kind === 'hit' ? 'You were hit! -1 HP. Answer faster and correctly to strike back.' : fx.kind === 'clash' ? 'Both fighters were hit!' : 'Shield up — nobody took damage.') : charging ? (gameMode === 'RPS' ? 'Move locked… gathering energy while your rival decides.' : 'Answer locked… charging your aura while your rival answers.') : 'Answer correctly and fastest to unleash your skill.'}</div>
  </section>;
}

function FlawlessHelp() {
  return <details className="mechanic-tip">
    <summary aria-label="How flawless victory healing works" title="How flawless victory healing works">?</summary>
    <div className="tip-card" role="tooltip">
      <strong>Flawless victory</strong>
      <p>Win an entire duel without losing any HP and you recover 1 HP, up to the 3 HP maximum. Taking even one hit during that duel means no healing.</p>
    </div>
  </details>;
}

function AccountBadge({ account, publicBeta = false, authenticated = false, onSignIn, onHost, onSignOut, compact = false }: {
  account?: Account;
  publicBeta?: boolean;
  authenticated?: boolean;
  onSignIn?: () => void;
  onHost?: () => void;
  onSignOut?: () => void;
  compact?: boolean;
}) {
  if (publicBeta && !authenticated) return <div className="beta-badge" title="Public beta access uses the paid-tier tournament limits"><span>BETA</span><small>50 PLAYER ACCESS</small>{onSignIn && <button type="button" onClick={onSignIn}>Sign in</button>}</div>;
  if (!account) return <button type="button" className="header-sign-in" onClick={onSignIn}>Sign in</button>;
  return <div className={`account-badge ${compact ? 'compact' : ''}`}>
    <span className="account-avatar" aria-hidden="true">{account.displayName.slice(0, 1).toUpperCase()}</span>
    <span className="account-identity"><b>{account.displayName}</b><small>{account.isAdmin ? 'ADMIN · ' : ''}{account.plan} HOST</small></span>
    {onHost && <button type="button" onClick={onHost}>Host</button>}
    {onSignOut && <button type="button" className="account-sign-out" onClick={onSignOut}>Sign out</button>}
  </div>;
}

function MatchCard({ match, players }: { match: MatchSummary; players: PublicPlayer[] }) {
  return (
    <article className={`match-card ${match.phase.toLowerCase()}`}>
      <div className="match-label">Match {match.id.slice(-4)} · Q{match.questionNumber}</div>
      {match.participantIds.map((id) => {
        const player = players.find((candidate) => candidate.id === id);
        if (!player) return null;
        return <div className={match.aliveIds.includes(id) ? 'combatant' : 'combatant out'} key={id}>
          <span className="combatant-name"><PlayerAvatar player={player} />{player.name}</span><strong>{hpDisplay(player.hp)}</strong>
        </div>;
      })}
      <div className="phase">{match.phase === 'COMPLETE' ? `Winner: ${playerName(players, match.winnerId ?? '')}` : match.phase}</div>
    </article>
  );
}

function TournamentProgression({ matches, players, championId }: { matches: MatchHistoryEntry[]; players: PublicPlayer[]; championId?: string }) {
  const rounds = Array.from(new Set(matches.map((match) => match.round))).sort((left, right) => left - right);
  return <section className="progression-section">
    <div className="section-title"><div><div className="eyebrow">TOURNAMENT JOURNEY</div><h2>Match history</h2></div><span>Winners advance from left to right</span></div>
    <div className="progression-scroll"><div className="progression-track">
      {rounds.map((round) => {
        const roundMatches = matches.filter((match) => match.round === round);
        return <div className="round-column" key={round}>
          <header><strong>Round {round}</strong><span>{roundMatches.length} match{roundMatches.length === 1 ? '' : 'es'}</span></header>
          <div>{roundMatches.map((match, matchIndex) => <article className={`history-match ${match.phase.toLowerCase()}`} key={match.id}>
            <small>Match {matchIndex + 1} · {match.phase === 'COMPLETE' ? 'Final' : `Question ${match.questionNumber}`}</small>
            {match.participantIds.map((id) => {
              const player = players.find((candidate) => candidate.id === id);
              const won = match.winnerId === id;
              const alive = match.aliveIds.includes(id);
              return <div className={`${won ? 'advanced' : ''} ${!alive ? 'knocked-out' : ''}`} key={id}>
                <PlayerAvatar player={player} />
                <span><b>{player?.name ?? 'Unknown player'}</b><em>{won ? 'Advances' : match.phase === 'COMPLETE' ? 'Eliminated' : alive ? 'Battling' : 'Eliminated'}</em></span>
                <strong>{hpDisplay(match.hp[id] ?? player?.hp ?? 0)}</strong>
              </div>;
            })}
          </article>)}</div>
        </div>;
      })}
      {championId && <div className="champion-column"><span>🏆</span><small>CHAMPION</small><PlayerAvatar player={players.find((player) => player.id === championId)} large /><strong>{playerName(players, championId)}</strong></div>}
    </div></div>
  </section>;
}

const winnerEndings = [
  { theme: 'sovereign', crown: '♛', left: 'THE ARENA FALLS SILENT…', rightLead: 'ENTERED.', rightBold: 'ONE REMAINS.', title: 'claimed the throne.', quote: 'Every challenger fell. Every round was survived. The crown belongs to one.' },
  { theme: 'final-boss', crown: '☠', left: 'THE BRACKET FOUND ITS FINAL BOSS.', rightLead: 'CHALLENGERS APPROACHED.', rightBold: 'NONE PASSED.', title: 'became the final boss.', quote: 'They came looking for the finish line. They found you standing in front of it.' },
  { theme: 'storm', crown: '⚡', left: 'THE DUST FINALLY SETTLES…', rightLead: 'FOUGHT THROUGH THE STORM.', rightBold: 'ONE STOOD.', title: 'stood after the storm.', quote: 'Fast answers. Cold nerves. No one else survived the forecast.' },
  { theme: 'legend', crown: '★', left: 'THE BRACKET HAD MANY NAMES.', rightLead: 'NAMES WERE WRITTEN.', rightBold: 'HISTORY KEPT ONE.', title: 'became the legend.', quote: 'This was not luck. Luck does not survive every round.' },
] as const;

const arenaToneOptions: Array<{ id: ArenaTone; level: number; label: string; description: string; winner: string; loser: string }> = [
  { id: 'RESPECTFUL', level: 1, label: 'Respectful', description: 'Supportive and sportsmanlike.', winner: 'A well-earned victory.', loser: 'Strong effort. Your next run starts here.' },
  { id: 'FRIENDLY', level: 2, label: 'Friendly', description: 'Light classroom banter.', winner: 'You survived the arena!', loser: 'Promoted to spectator—with the best seats.' },
  { id: 'COMPETITIVE', level: 3, label: 'Competitive', description: 'Sharper rivalry without going too far.', winner: 'The bracket has been conquered.', loser: 'Outplayed this time. Rebuild and return.' },
  { id: 'RAGEBAIT', level: 4, label: 'Ragebait', description: 'Provocative lines designed to get a reaction.', winner: 'Keep watching. You might learn something.', loser: 'That answer was confidently incorrect.' },
  { id: 'NO_MERCY', level: 5, label: 'No Mercy', description: 'Blunt get-good energy with no soft landing.', winner: 'Sit down. The champion is speaking.', loser: 'Skill issue. Study harder and queue again.' },
];

const winnerCopyByTone: Record<ArenaTone, Array<{ left: string; rightLead: string; rightBold: string; title: string; quote: string }>> = {
  RESPECTFUL: [
    { left: 'THE FINAL ROUND ENDS.', rightLead: 'FOUGHT WITH FOCUS.', rightBold: 'VICTORY EARNED.', title: 'earned the crown.', quote: 'A composed run, a strong finish, and a victory worth celebrating.' },
    { left: 'EVERY ROUND WAS A TEST.', rightLead: 'SKILL ENDURED.', rightBold: 'ONE PREVAILED.', title: 'rose above the field.', quote: 'Well played from the opening clash to the final answer.' },
  ],
  FRIENDLY: [
    { left: 'THE BRACKET HAS SPOKEN.', rightLead: 'EVERYONE CAME TO PLAY.', rightBold: 'ONE STAYED.', title: 'survived the chaos.', quote: 'Good answers, quick hands, and just enough luck to keep the crown.' },
    { left: 'THE ARENA WAS BUSY.', rightLead: 'THE CLASS BROUGHT HEAT.', rightBold: 'YOU BROUGHT MORE.', title: 'won bragging rights.', quote: 'Enjoy the crown. The rematch requests are already loading.' },
  ],
  COMPETITIVE: [
    { left: 'THE PRESSURE KEPT RISING.', rightLead: 'THE FIELD FOUGHT BACK.', rightBold: 'YOU HELD FIRM.', title: 'conquered the bracket.', quote: 'Prepared faster, answered cleaner, and finished stronger.' },
    { left: 'NO EASY MATCHES.', rightLead: 'NO FREE ADVANCES.', rightBold: 'NO DOUBT.', title: 'proved who was ready.', quote: 'The standings are final. The result speaks for itself.' },
  ],
  RAGEBAIT: [
    { left: 'THE LOBBY HAD HOPE.', rightLead: 'THEY QUEUED UP.', rightBold: 'YOU SENT THEM HOME.', title: 'made the bracket look easy.', quote: 'Keep watching, challengers. You might learn something.' },
    { left: 'THEY SAID IT WAS CLOSE.', rightLead: 'THE SCOREBOARD CHECKED.', rightBold: 'IT WAS NOT.', title: 'collected the excuses.', quote: 'Everyone had a plan until your answer locked first.' },
  ],
  NO_MERCY: [
    { left: 'THE CHALLENGERS TALKED.', rightLead: 'THEY STEPPED UP.', rightBold: 'THEY GOT SAT DOWN.', title: 'owns this lobby.', quote: 'Class dismissed. The champion has nothing left to prove.' },
    { left: 'THE BRACKET NEEDED A BOSS.', rightLead: 'THEY TRIED THEIR BEST.', rightBold: 'THAT WAS THE PROBLEM.', title: 'turned the finals into a tutorial.', quote: 'Queue again when the skill issue has been resolved.' },
  ],
};

function endingIndex(seed: string, length: number) {
  return Array.from(seed).reduce((total, character) => (total * 31 + character.charCodeAt(0)) >>> 0, 7) % length;
}

function winnerEndingFor(code: string, playerId: string) {
  return winnerEndings[endingIndex(`${code}:${playerId}`, winnerEndings.length)];
}

const defeatTaunts = [
  'Your HP hit zero. Your comeback arc starts now.',
  'The bracket said “not today.” The replay says “study up.”',
  'You have been promoted to professional spectator. Excellent seats, though.',
  'That answer was fast. Correct would have helped too.',
  'The crown rejected the application. Reapply next tournament.',
  'A brave run. A dramatic exit. A suspiciously alive opponent.',
] as const;

const defeatTauntsByTone: Record<ArenaTone, readonly string[]> = {
  RESPECTFUL: ['Strong effort. Your next run starts here.', 'A solid attempt. Review, reload, and return stronger.', 'The run ends here, but the lesson carries forward.'],
  FRIENDLY: defeatTaunts,
  COMPETITIVE: ['Outplayed this time. Rebuild and return.', 'The bracket moved on. Your rematch starts with preparation.', 'Close is not enough in the arena. Come back sharper.'],
  RAGEBAIT: ['That answer was confidently incorrect.', 'Almost impressive—if the goal was losing.', 'You were one correct answer away. Repeatedly.', 'The spectator seats were waiting for you.'],
  NO_MERCY: ['Skill issue. Study harder and queue again.', 'You did not lose to the timer. You lost to the tutorial.', 'Three hearts were clearly three too many.', 'Pack it up. The bracket already forgot your name.'],
};

function defeatTauntFor(code: string, playerId: string, tone: ArenaTone) {
  const lines = defeatTauntsByTone[tone] ?? defeatTauntsByTone.RESPECTFUL;
  return lines[endingIndex(`${playerId}:${code}:defeat`, lines.length)];
}

function winnerCopyFor(code: string, playerId: string, tone: ArenaTone) {
  const lines = winnerCopyByTone[tone] ?? winnerCopyByTone.RESPECTFUL;
  return lines[endingIndex(`${code}:${playerId}:winner-copy`, lines.length)];
}

function arenaToneLabel(tone: ArenaTone) {
  return arenaToneOptions.find((option) => option.id === tone)?.label ?? 'Respectful';
}

type MusicScene = 'menu' | 'lobby' | 'battle' | 'spectator' | 'off';

let activeScoreStop: (() => void) | null = null;

function claimAudioChannel(stop: () => void) {
  if (activeScoreStop && activeScoreStop !== stop) activeScoreStop();
  activeScoreStop = stop;
}

function createBackgroundScore(scene: Exclude<MusicScene, 'off'>) {
  const context = new AudioContext();
  const master = context.createGain();
  const filter = context.createBiquadFilter();
  master.gain.value = scene === 'battle' ? 0.18 : 0.14;
  filter.type = 'lowpass';
  filter.frequency.value = scene === 'battle' ? 2600 : 1700;
  master.connect(filter).connect(context.destination);
  let stopped = false;
  let started = false;
  let cycleTimer: number | undefined;
  const roots = scene === 'battle' ? [110, 130.81, 146.83, 98] : scene === 'spectator' ? [98, 123.47, 146.83, 110] : [110, 146.83, 130.81, 164.81];
  const step = scene === 'battle' ? 0.28 : scene === 'menu' ? 0.5 : 0.42;
  const cycleSeconds = step * 32;

  const scheduleTone = (frequency: number, at: number, duration: number, type: OscillatorType, volume: number) => {
    const oscillator = context.createOscillator();
    const envelope = context.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, at);
    envelope.gain.setValueAtTime(0.0001, at);
    envelope.gain.exponentialRampToValueAtTime(volume, at + 0.025);
    envelope.gain.exponentialRampToValueAtTime(0.0001, at + duration);
    oscillator.connect(envelope).connect(master);
    oscillator.start(at);
    oscillator.stop(at + duration + 0.03);
  };

  const scheduleCycle = () => {
    if (stopped) return;
    const start = context.currentTime + 0.08;
    roots.forEach((root, bar) => {
      const barStart = start + bar * step * 8;
      scheduleTone(root / 2, barStart, step * 7.7, 'sine', 0.14);
      scheduleTone(root, barStart, step * 7.7, 'triangle', 0.07);
      const chord = [root, root * 1.25, root * 1.5, root * 2];
      for (let beat = 0; beat < 8; beat += 1) {
        const note = chord[(beat + bar) % chord.length];
        scheduleTone(note * 2, barStart + beat * step, step * 0.72, 'triangle', scene === 'battle' ? 0.085 : 0.06);
        if (scene === 'battle' && beat % 2 === 0) scheduleTone(58, barStart + beat * step, 0.09, 'sine', 0.15);
      }
    });
  };

  const stop = () => {
    if (stopped) return;
    stopped = true;
    if (cycleTimer) window.clearInterval(cycleTimer);
    master.gain.cancelScheduledValues(context.currentTime);
    master.gain.setValueAtTime(0, context.currentTime);
    if (activeScoreStop === stop) activeScoreStop = null;
    void context.close().catch(() => undefined);
  };

  const start = () => {
    if (started || stopped) return;
    started = true;
    claimAudioChannel(stop);
    void context.resume().then(() => {
      if (stopped) return;
      scheduleCycle();
      cycleTimer = window.setInterval(scheduleCycle, Math.max(1000, (cycleSeconds - 0.12) * 1000));
    }).catch(() => undefined);
  };

  return {
    start,
    stop,
  };
}

function useBackgroundMusic(scene: MusicScene) {
  const [enabled, setEnabled] = useState(() => localStorage.getItem('zerosum-music') !== 'off');
  const [playing, setPlaying] = useState(false);
  const controller = useRef<ReturnType<typeof createBackgroundScore> | null>(null);
  const unlocked = useRef(false);

  const startNow = useCallback(() => {
    if (scene === 'off' || controller.current) return;
    unlocked.current = true;
    controller.current = createBackgroundScore(scene);
    controller.current.start();
    setPlaying(true);
  }, [scene]);

  const stopNow = useCallback(() => {
    controller.current?.stop();
    controller.current = null;
    setPlaying(false);
  }, []);

  useEffect(() => {
    if (!enabled || scene === 'off') {
      stopNow();
      return;
    }
    if (controller.current) return stopNow;
    if (unlocked.current) startNow();
    else {
      const unlock = (event: Event) => {
        if (event.target instanceof Element && event.target.closest('.music-control')) return;
        startNow();
      };
      window.addEventListener('pointerdown', unlock, { once: true });
      window.addEventListener('keydown', unlock, { once: true });
      return () => {
        window.removeEventListener('pointerdown', unlock);
        window.removeEventListener('keydown', unlock);
        stopNow();
      };
    }
    return stopNow;
  }, [enabled, scene, startNow, stopNow]);

  const toggle = () => {
    if (enabled && !playing) {
      startNow();
      return;
    }
    if (enabled) {
      localStorage.setItem('zerosum-music', 'off');
      setEnabled(false);
      stopNow();
    } else {
      localStorage.setItem('zerosum-music', 'on');
      setEnabled(true);
      startNow();
    }
  };

  return { enabled, playing, toggle };
}

function MusicControl({ enabled, playing, onToggle }: { enabled: boolean; playing: boolean; onToggle: () => void }) {
  const label = playing ? 'Mute background music' : enabled ? 'Play background music' : 'Unmute background music';
  return <button type="button" className={`music-control ${playing ? 'playing' : 'muted'}`} aria-label={label} aria-pressed={playing} title={label} onClick={onToggle}><span aria-hidden="true">♫</span></button>;
}

function playVictoryScore(theme: typeof winnerEndings[number]['theme'], onEnded: () => void, onStarted: () => void) {
  const AudioContextClass = window.AudioContext;
  if (!AudioContextClass) return () => undefined;
  const context = new AudioContextClass();
  const master = context.createGain();
  master.gain.setValueAtTime(0.0001, context.currentTime);
  master.connect(context.destination);
  let stopped = false;
  let timer: number | undefined;
  const themes = {
    sovereign: [196, 246.94, 293.66, 392, 493.88, 587.33, 783.99],
    'final-boss': [146.83, 174.61, 220, 293.66, 349.23, 440, 587.33],
    storm: [164.81, 220, 277.18, 329.63, 440, 554.37, 659.25],
    legend: [174.61, 220, 261.63, 349.23, 440, 523.25, 698.46],
  } as const;
  const notes = themes[theme];
  const schedule = (frequency: number, start: number, at: number, duration: number, type: OscillatorType, volume: number) => {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, start + at);
    gain.gain.setValueAtTime(0.0001, start + at);
    gain.gain.exponentialRampToValueAtTime(volume, start + at + 0.035);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + at + duration);
    oscillator.connect(gain).connect(master);
    oscillator.start(start + at);
    oscillator.stop(start + at + duration + 0.04);
  };
  const stop = () => {
    if (stopped) return;
    stopped = true;
    if (timer) window.clearTimeout(timer);
    master.gain.cancelScheduledValues(context.currentTime);
    master.gain.setValueAtTime(0, context.currentTime);
    if (activeScoreStop === stop) activeScoreStop = null;
    void context.close().catch(() => undefined);
  };
  claimAudioChannel(stop);
  void context.resume().then(() => {
    if (stopped || context.state !== 'running') return;
    const start = context.currentTime + 0.06;
    master.gain.exponentialRampToValueAtTime(0.42, context.currentTime + 0.15);
    master.gain.setValueAtTime(0.42, context.currentTime + 8.1);
    master.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 9.4);
    [0, 2.4, 4.8].forEach((at, chordIndex) => {
      const root = notes[chordIndex % 3];
      schedule(root / 2, start, at, 2.15, 'sawtooth', 0.13);
      schedule(root, start, at, 2.15, 'triangle', 0.08);
      schedule(root * 1.5, start, at, 2.15, 'triangle', 0.055);
    });
    notes.forEach((frequency, index) => schedule(frequency, start, 0.45 + index * 0.72, 0.58, index > 4 ? 'square' : 'triangle', 0.11));
    [0, 1.2, 2.4, 3.6, 4.8, 6].forEach((at) => schedule(65.41, start, at, 0.2, 'sine', 0.18));
    schedule(notes[6], start, 6.25, 2.85, 'triangle', 0.12);
    schedule(notes[4], start, 6.25, 2.85, 'sine', 0.08);
    onStarted();
    timer = window.setTimeout(() => {
      stop();
      onEnded();
    }, 9600);
  }).catch(() => {
    stop();
    onEnded();
  });
  return stop;
}

function ChampionThrone({ snapshot, me, onDownloadLeaderboard, onReturnHome }: {
  snapshot: Snapshot;
  me: PublicPlayer;
  onDownloadLeaderboard: () => void;
  onReturnHome: () => void;
}) {
  const defeated = snapshot.players.filter((player) => player.id !== me.id);
  const visual = winnerEndingFor(snapshot.tournament.code, me.id);
  const ending = { ...visual, ...winnerCopyFor(snapshot.tournament.code, me.id, snapshot.tournament.arenaTone) };
  const stopMusic = useRef<(() => void) | null>(null);
  const [musicPlaying, setMusicPlaying] = useState(false);
  const startMusic = useCallback(() => {
    stopMusic.current?.();
    stopMusic.current = playVictoryScore(ending.theme, () => setMusicPlaying(false), () => setMusicPlaying(true));
  }, [ending.theme]);
  useEffect(() => {
    if (localStorage.getItem('zerosum-music') !== 'off') startMusic();
    return () => stopMusic.current?.();
  }, [startMusic]);
  const toggleMusic = () => {
    if (musicPlaying) {
      localStorage.setItem('zerosum-music', 'off');
      stopMusic.current?.();
      stopMusic.current = null;
      setMusicPlaying(false);
    } else {
      localStorage.setItem('zerosum-music', 'on');
      startMusic();
    }
  };
  return <main className={`shell throne-ending ending-${ending.theme}`}>
    <div className="confetti">{Array.from({ length: 24 }, (_, index) => <i key={index} style={{ '--i': index, '--x': `${(index * 43) % 100}%` } as React.CSSProperties}/>)}</div>
    <section className="manga-stage">
      <div className="speed-lines"/>
      <div className="commentary commentary-one">{ending.left}</div>
      <div className="commentary commentary-two">{snapshot.tournament.playerCount} {ending.rightLead}<br/><b>{ending.rightBold}</b></div>
      <div className="throne">
        <span className="throne-crown">{ending.crown}</span>
        <div className="throne-back"/>
        <PlayerAvatar player={me} large />
        <strong>{me.name}</strong>
        <small>THE LAST PLAYER STANDING</small>
      </div>
      <div className="fallen-army" aria-label={`${defeated.length} defeated challengers`}>
        {defeated.map((player, index) => <span style={{ '--fallen-rotation': `${-28 + index % 7 * 9}deg`, '--fallen-drop': `${index % 3 * 8}px` } as React.CSSProperties} title={player.name} key={player.id}><FighterAvatar seed={player.avatar} pose="ko" /></span>)}
      </div>
      <div className="victory-word">ZERØSUM</div>
    </section>
    <section className="ending-caption"><span>🏆 TOURNAMENT {snapshot.tournament.code}</span><h1>{me.name} {ending.title}</h1><p>“{ending.quote}”</p><button className={`victory-sound ${musicPlaying ? 'playing' : 'muted'}`} aria-label={musicPlaying ? 'Mute victory theme' : 'Play victory theme'} aria-pressed={musicPlaying} title={musicPlaying ? 'Mute victory theme' : 'Play victory theme'} onClick={toggleMusic}><span className="victory-music-icon" aria-hidden="true">♫</span><b>Victory theme</b></button><div className="victory-actions"><button className="share-action" onClick={onDownloadLeaderboard}>Download leaderboard</button><button className="action" onClick={onReturnHome}>Enter a new arena</button></div></section>
  </main>;
}

function SpectatorArena({ snapshot, me, bracket, bracketOpen, onViewBracket, onCloseBracket, onDownloadLeaderboard, onReturnHome }: {
  snapshot: Snapshot;
  me?: PublicPlayer;
  bracket: MatchHistoryEntry[];
  bracketOpen: boolean;
  onViewBracket: () => void;
  onCloseBracket: () => void;
  onDownloadLeaderboard: () => void;
  onReturnHome: () => void;
}) {
  const complete = snapshot.tournament.phase === 'COMPLETE';
  const survived = me?.status === 'WAITING';
  const champion = snapshot.players.find((player) => player.id === snapshot.tournament.championId);
  const defeatTaunt = me ? defeatTauntFor(snapshot.tournament.code, me.id, snapshot.tournament.arenaTone) : defeatTauntsByTone.RESPECTFUL[0];
  const defeatScene = me ? endingIndex(`${snapshot.tournament.code}:${me.id}:scene`, 4) : 0;
  return <main className="shell spectator">
    <header><div className="brand"><span className="cloud-mark">Ø</span>ZEROSUM <span className="live-dot">LIVE</span></div><div className="round-pill">{complete ? 'TOURNAMENT COMPLETE' : `ROUND ${snapshot.tournament.round}`}</div></header>
    <section className={`spectator-hero ${survived ? 'survivor' : `defeat-scene-${defeatScene}`}`}>
      <PlayerAvatar player={me} large />
      <div><div className="eyebrow">{complete ? 'FINAL RESULTS' : survived ? 'SURVIVOR LOUNGE' : 'SPECTATOR MODE'}</div><h1>{complete ? `${champion?.name ?? 'A champion'} stands alone.` : survived ? 'You advanced. Watch the arena.' : 'You’re out—but the clash lives on.'}</h1><p>{complete ? `${champion?.name ?? 'The champion'} took the crown. You got the character development.` : survived ? `Follow every battle live while ${snapshot.tournament.activeCount} players remain. Your next opponent is still fighting for the privilege.` : defeatTaunt}</p></div>
    </section>
    <div className="spectator-actions"><button className="action" onClick={onViewBracket}>View tournament bracket</button>{complete && <button className="share-action" onClick={onDownloadLeaderboard}>🏆 Download leaderboard</button>}{complete && <button className="secondary-action" onClick={onReturnHome}>Return home</button>}</div>
    {!complete && <section className="spectator-live"><div className="section-title"><div><div className="eyebrow">LIVE ARENA</div><h2>Watch the remaining battles</h2></div><span><i className="pulse-dot"/> Updates automatically · no extra connection</span></div><div className="spectator-stats"><div><strong>{snapshot.tournament.activeCount}</strong><span>Still standing</span></div><div><strong>{snapshot.matches.filter((match) => match.phase === 'COMPLETE').length}/{snapshot.matches.length}</strong><span>Matches finished</span></div><div><strong>{snapshot.tournament.round}</strong><span>Current round</span></div></div><div className="match-grid">{snapshot.matches.map((match) => <MatchCard key={match.id} match={match} players={snapshot.players}/>)}</div></section>}
    {bracketOpen && <div className="dashboard-modal" role="dialog" aria-modal="true" aria-label="Tournament bracket" onClick={onCloseBracket}><section className="dashboard-modal-panel" onClick={(event) => event.stopPropagation()}><button className="modal-close" aria-label="Close tournament bracket" onClick={onCloseBracket}>×</button>{bracket.length ? <TournamentProgression matches={bracket} players={snapshot.players} championId={snapshot.tournament.championId}/> : <div className="bracket-loading"><div className="spinner"/><h2>Loading the bracket…</h2></div>}</section></div>}
  </main>;
}

function QuestionReview({ questions, matches, gameMode = 'QUIZ' }: { questions: QuestionPreview[]; matches: MatchHistoryEntry[]; gameMode?: 'QUIZ' | 'RPS' }) {
  const usage = (questionId: string) => matches.flatMap((match) => {
    const questionNumber = match.questionIds.indexOf(questionId);
    if (questionNumber < 0) return [];
    const roundMatches = matches.filter((candidate) => candidate.round === match.round);
    return [`Round ${match.round} · Match ${roundMatches.findIndex((candidate) => candidate.id === match.id) + 1} · Q${questionNumber + 1}`];
  });

  return <div className="question-review">
    {questions.length === 0 ? <p className="muted">Questions will appear here after the first match begins.</p> : questions.map((question, questionIndex) => <article className="review-question" key={question.id}>
      <header><div><span>{gameMode === 'RPS' ? 'Move round' : 'Question'} {questionIndex + 1}</span><b>{question.id.slice(0, 8)}</b></div><em>{gameMode === 'RPS' ? 'Player choice' : questionLabel(question)} · {question.difficulty}</em></header>
      <div className="usage-badges">{usage(question.id).map((label) => <span key={label}>{label}</span>)}</div>
      <h3>{question.text}</h3>
      <ol type="A">{question.options.map((option, optionIndex) => <li className={gameMode !== 'RPS' && optionIndex === question.correctIndex ? 'correct' : ''} key={option}><span>{option}</span>{gameMode !== 'RPS' && optionIndex === question.correctIndex && <strong>Correct answer</strong>}</li>)}</ol>
      <p><strong>{gameMode === 'RPS' ? 'Rule:' : 'Why:'}</strong> {question.explanation}</p>
    </article>)}
  </div>;
}

function escapeHtml(value: unknown) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[character] ?? character));
}

type RecentWinner = { code: string; championName: string; championAvatar: string; bankName: string; playerCount: number; rounds: number; endedAt: number };
type TournamentHistory = { code: string; phase: string; bankName: string; rounds: number; playerCount: number; champion: { id: string; name: string; avatar: string } | null; players: Array<{ id: string; name: string; avatar: string; hp: number; status: string }>; matches: Array<{ round: number; questionNumber: number; participants: string[]; winnerName: string | null }>; events: Array<{ at: number; kind: string; message: string }> };

function downloadTournamentReport(report: TournamentReport) {
  const isRps = report.tournament.gameMode === 'RPS';
  const playerById = new Map(report.players.map((player) => [player.id, player]));
  const rounds = Array.from(new Set(report.matchHistory.map((match) => match.round))).sort((left, right) => left - right);
  const questionById = new Map(report.reviewQuestions.map((question) => [question.id, question]));
  const usages = new Map<string, string[]>();
  for (const match of report.matchHistory) {
    const roundMatches = report.matchHistory.filter((candidate) => candidate.round === match.round);
    const matchNumber = roundMatches.findIndex((candidate) => candidate.id === match.id) + 1;
    match.questionIds.forEach((questionId, index) => usages.set(questionId, [...(usages.get(questionId) ?? []), `Round ${match.round} · Match ${matchNumber} · Q${index + 1}`]));
  }
  const champion = report.tournament.championId ? playerById.get(report.tournament.championId) : undefined;
  const matchHtml = rounds.map((round) => `<section class="round"><h2>Round ${round}</h2><div class="matches">${report.matchHistory.filter((match) => match.round === round).map((match, index) => `<article class="match"><h3>Match ${index + 1} <small>${escapeHtml(match.phase)}</small></h3>${match.participantIds.map((id) => { const player = playerById.get(id); return `<div class="participant ${match.winnerId === id ? 'winner' : ''}"><span>${fighterSvgMarkup(player?.avatar)} ${escapeHtml(player?.name ?? 'Unknown player')}</span><b>${escapeHtml(hpDisplay(match.hp[id] ?? player?.hp ?? 0))}</b>${match.winnerId === id ? '<em>ADVANCES</em>' : ''}</div>`; }).join('')}<p>${match.questionIds.length} question${match.questionIds.length === 1 ? '' : 's'} used</p></article>`).join('')}</div></section>`).join('');
  const questionHtml = report.reviewQuestions.map((question, index) => `<article class="question"><header><b>${isRps ? 'Move round' : 'Question'} ${index + 1}</b><span>${escapeHtml(question.id.slice(0, 8))} · ${escapeHtml(isRps ? 'Player choice' : questionLabel(question))} · ${escapeHtml(question.difficulty)}</span></header><div class="used-in">${(usages.get(question.id) ?? []).map((label) => `<span>${escapeHtml(label)}</span>`).join('')}</div><h3>${escapeHtml(question.text)}</h3><ol type="A">${question.options.map((option, optionIndex) => `<li class="${!isRps && optionIndex === question.correctIndex ? 'correct' : ''}">${escapeHtml(option)}${!isRps && optionIndex === question.correctIndex ? '<strong>✓ Correct answer</strong>' : ''}</li>`).join('')}</ol><p><b>${isRps ? 'Rule' : 'Explanation'}:</b> ${escapeHtml(question.explanation)}</p></article>`).join('');
  const eventHtml = report.events.map((event) => { const questionId = typeof event.details?.questionId === 'string' ? event.details.questionId : ''; const question = questionId ? questionById.get(questionId) : undefined; return `<tr><td>${escapeHtml(new Date(event.at).toLocaleString())}</td><td>${escapeHtml(event.kind.replaceAll('_', ' '))}</td><td>${escapeHtml(question ? `${question.id}: ${question.text}` : questionId)}</td><td>${escapeHtml(event.message)}</td><td><code>${escapeHtml(JSON.stringify(event.details ?? {}))}</code></td></tr>`; }).join('');
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Zerosum ${escapeHtml(report.tournament.code)} Review</title><style>
  :root{color-scheme:light;--ink:#10232d;--muted:#58707a;--cyan:#087f94;--orange:#e46f12;--green:#087c50}*{box-sizing:border-box}body{margin:0;background:#eef4f6;color:var(--ink);font:14px/1.55 Arial,sans-serif}.page{max-width:1180px;margin:auto;padding:34px}.hero{padding:32px;border-radius:18px;background:linear-gradient(135deg,#061d29,#0b4453);color:white}.hero h1{margin:4px 0 9px;font-size:36px}.hero .code{color:#ffad52;letter-spacing:.18em}.stats{display:flex;flex-wrap:wrap;gap:10px;margin-top:18px}.stats span,.used-in span{padding:6px 10px;border-radius:99px;background:#ffffff18}.block{margin:24px 0;padding:24px;border:1px solid #cadadd;border-radius:15px;background:white;box-shadow:0 8px 24px #17333d0b}.round{margin:25px 0}.matches{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:12px}.match{padding:14px;border:1px solid #d5e1e4;border-radius:10px;background:#f8fbfc}.match h3{margin-top:0}.match small{float:right;color:var(--muted)}.participant{display:grid;grid-template-columns:1fr auto auto;gap:9px;padding:8px;border-top:1px solid #e6edef}.participant em{color:var(--green);font-size:10px}.participant svg{width:22px;height:22px;vertical-align:-6px;margin-right:6px}.participant.winner{border-left:4px solid #18a96d;background:#e9f8f1}.match p{margin-bottom:0;color:var(--muted);font-size:12px}.question{page-break-inside:avoid;margin:15px 0;padding:20px;border:1px solid #d4e1e4;border-radius:12px}.question header{display:flex;justify-content:space-between;gap:15px;color:var(--cyan)}.used-in{display:flex;flex-wrap:wrap;gap:6px;margin:12px 0}.used-in span{background:#e6f4f6;color:#176579;font-size:11px}.question li{padding:6px 10px}.question li.correct{border-radius:6px;background:#e6f7ee;color:var(--green);font-weight:bold}.question li strong{float:right}.question>p{padding:12px;border-left:4px solid var(--orange);background:#fff6ea}table{width:100%;border-collapse:collapse;font-size:12px}th,td{padding:9px;border:1px solid #d8e3e6;text-align:left;vertical-align:top}th{background:#0b4352;color:white}code{white-space:pre-wrap;word-break:break-word}.empty{color:var(--muted)}@media print{body{background:white}.page{max-width:none;padding:0}.block{box-shadow:none}.hero{print-color-adjust:exact}.events{page-break-before:always}}@media(max-width:650px){.page{padding:12px}.hero,.block{padding:18px}.question header{display:block}.event-wrap{overflow:auto}}
  </style></head><body><main class="page"><section class="hero"><small>ZEROSUM · GAME REVIEW REPORT</small><h1>Tournament <span class="code">${escapeHtml(report.tournament.code)}</span></h1><p>Status: ${escapeHtml(report.tournament.phase)}${champion ? ` · Champion: ${escapeHtml(champion.name)}` : ''}</p><div class="stats"><span>${report.players.length} players</span><span>${report.matchHistory.length} matches</span><span>${report.reviewQuestions.length} questions used</span><span>${report.tournament.questionSeconds}s per question</span><span>${escapeHtml(arenaToneLabel(report.tournament.arenaTone))} arena tone</span><span>Flawless healing ${report.tournament.flawlessBonus ? 'on' : 'off'}</span></div></section><section class="block"><h1>Tournament progression</h1>${matchHtml || '<p class="empty">No matches were played.</p>'}</section><section class="block"><h1>Challenges used & answer review</h1><p>Challenges appear once, with every match where they were used listed below the heading.</p>${questionHtml || '<p class="empty">No challenges were used.</p>'}</section><section class="block events"><h1>Complete event log</h1><div class="event-wrap"><table><thead><tr><th>Time</th><th>Event</th><th>Challenge</th><th>Message</th><th>Details</th></tr></thead><tbody>${eventHtml}</tbody></table></div></section></main></body></html>`;
  const url = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `zerosum-${report.tournament.code}-review.html`;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function downloadLeaderboard(report: LeaderboardReport) {
  const championId = report.tournament.championId;
  const standings = report.players.map((player) => {
    const appearances = report.matchHistory.filter((match) => match.participantIds.includes(player.id));
    return {
      player,
      wins: report.matchHistory.filter((match) => match.winnerId === player.id).length,
      round: Math.max(0, ...appearances.map((match) => match.round)),
    };
  }).sort((left, right) => Number(right.player.id === championId) - Number(left.player.id === championId)
    || right.round - left.round || right.wins - left.wins || left.player.name.localeCompare(right.player.name));
  const champion = standings[0];
  const ending = winnerEndingFor(report.tournament.code, champion?.player.id ?? 'champion');
  const fallen = standings.slice(1).map((standing, index) => {
    const rotation = -25 + (index % 7) * 8;
    const drop = (index % 3) * 7;
    return `<span class="fallen" style="--r:${rotation}deg;--d:${drop}px" title="${escapeHtml(standing.player.name)}">${fighterSvgMarkup(standing.player.avatar, 'ko')}</span>`;
  }).join('');
  const podium = standings.slice(0, 3).map((standing, index) => `<article class="podium p${index + 1}"><div class="medal">${['🏆', '🥈', '🥉'][index]}</div><div class="avatar">${fighterSvgMarkup(standing.player.avatar)}</div><small>#${index + 1}</small><h2>${escapeHtml(standing.player.name)}</h2><p>${index === 0 ? 'LAST PLAYER STANDING' : `${standing.wins} match win${standing.wins === 1 ? '' : 's'}`}</p></article>`).join('');
  const rows = standings.map((standing, index) => `<tr class="${standing.player.id === championId ? 'champion' : ''}"><td>#${index + 1}</td><td><span class="mini-avatar">${fighterSvgMarkup(standing.player.avatar)}</span><b>${escapeHtml(standing.player.name)}</b></td><td>${standing.wins}</td><td>${standing.player.id === championId ? 'Champion' : `Reached Round ${standing.round}`}</td></tr>`).join('');
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Zerosum ${escapeHtml(report.tournament.code)} Leaderboard</title><style>
  :root{color-scheme:dark;--ink:#ecf8fb;--muted:#8ba4ae;--cyan:#5cdef0;--orange:#ff9d3a;--gold:#ffd36d}*{box-sizing:border-box}body{margin:0;min-width:320px;background:radial-gradient(circle at 50% -10%,#15465b,#07151e 44%,#03090e);color:var(--ink);font:15px/1.5 Inter,Arial,sans-serif}.page{width:min(1100px,calc(100% - 28px));margin:auto;padding:38px 0 60px}.hero{position:relative;min-height:650px;overflow:hidden;border:3px solid #05090c;border-radius:24px;background:radial-gradient(circle at 50% 26%,#dcefff 0 2%,#7fb2dd 3% 9%,#274b6d 24%,#0d2036 58%,#020509 100%);box-shadow:0 30px 90px #000c;text-align:center;isolation:isolate}.hero.final-boss{background:radial-gradient(circle at 50% 26%,#f3e2ff 0 2%,#c084fc 3% 9%,#5b21b6 24%,#1c1030 58%,#030207 100%)}.hero.storm{background:radial-gradient(circle at 50% 26%,#e6fbff 0 2%,#7dd3fc 3% 9%,#1d6f8e 24%,#0a2436 58%,#020608 100%)}.hero.legend{background:radial-gradient(circle at 50% 26%,#fff6cf 0 2%,#d9b64a 3% 9%,#6e5a14 24%,#1d1a0c 58%,#040403 100%)}.hero:before{content:'';position:absolute;inset:-30%;z-index:-2;background:repeating-conic-gradient(from 0deg at 50% 32%,transparent 0 3deg,#bcd8ff1c 3.3deg 3.7deg,transparent 4deg 7deg);transform:rotate(-4deg)}.hero:after{content:'';position:absolute;inset:0;z-index:-1;background:linear-gradient(90deg,#000a,transparent 20% 80%,#000a),linear-gradient(#0008,transparent 22% 72%,#000d)}.brand{position:absolute;z-index:6;left:28px;top:24px;color:var(--cyan);font-weight:900;letter-spacing:.24em}.commentary{position:absolute;z-index:7;max-width:260px;padding:13px 17px;border:3px solid #071018;background:#fff0c6;color:#11171b;box-shadow:6px 7px 0 #071018;font-weight:900;letter-spacing:.04em;transform:rotate(-2deg)}.commentary.left{left:5%;top:13%}.commentary.right{right:5%;top:16%;transform:rotate(2deg)}.commentary b{color:#a5241d;font-size:20px}.throne{position:absolute;z-index:4;left:50%;top:20%;width:280px;height:330px;transform:translateX(-50%);display:flex;flex-direction:column;align-items:center;justify-content:center}.throne-back{position:absolute;inset:0;z-index:-1;border:5px solid #1b0e0c;border-radius:46% 46% 18px 18px;background:linear-gradient(100deg,#0a1622,#33506e 45%,#1b324a 56%,#04090f);box-shadow:inset 0 0 0 9px #bcd8ff14,0 22px 35px #000b;clip-path:polygon(8% 0,92% 0,100% 100%,0 100%)}.crown{position:absolute;top:-47px;color:#d8b96a;font-size:58px;filter:drop-shadow(0 0 10px #c9a22766)}.champ-avatar{font-size:104px;line-height:1;filter:drop-shadow(0 0 22px #bfe3ff66)}.throne h1{max-width:250px;overflow:hidden;margin:12px 0 0;color:#eaf4ff;font-size:29px;text-overflow:ellipsis;text-shadow:3px 3px #04101d;white-space:nowrap}.throne small{color:#9fc6e8;font-size:10px;font-weight:900;letter-spacing:.15em}.fallen-army{position:absolute;z-index:3;left:5%;right:5%;bottom:6%;min-height:210px;display:flex;flex-wrap:wrap-reverse;justify-content:center;align-content:flex-end;align-items:flex-end;gap:0 5px;padding:50px 20px 8px}.fallen-army:before{content:'';position:absolute;inset:38% 0 0;z-index:-1;background:radial-gradient(ellipse,#0a1118 15%,#020507 68%);transform:skewX(-7deg)}.fallen{width:52px;height:52px;display:grid;place-items:center;border:2px solid #243744;border-radius:48% 52% 45% 55%;background:#0a1820;color:#73838a;font-size:32px;filter:grayscale(.68) brightness(.58) contrast(1.06);transform:rotate(var(--r)) translateY(var(--d));box-shadow:0 7px 10px #000a}.fallen:nth-child(4n){width:62px;height:62px;font-size:38px}.victory-word{position:absolute;z-index:1;left:50%;bottom:4%;transform:translateX(-50%) skew(-8deg);color:#ffffff0d;font:900 clamp(100px,20vw,220px)/.7 Arial,sans-serif;letter-spacing:-.09em;white-space:nowrap}.caption{padding:25px;background:linear-gradient(90deg,#07151e,#291a10,#07151e);text-align:center}.caption h2{margin:0;color:#d9ecff;font-size:clamp(28px,5vw,48px)}.caption p{margin:7px;color:#c9dce2;font-style:italic}.code{display:inline-block;margin-top:10px;padding:7px 13px;border:1px solid #60d7e557;border-radius:99px;color:#8ce9f4;letter-spacing:.17em}.podium-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;align-items:end;margin:30px 0}.podium{padding:26px 18px;border:1px solid #4a74835c;border-radius:18px;background:#0a202bbb;text-align:center}.podium.p1{order:2;min-height:300px;padding-top:34px;border-color:#7fb2dd8c;background:linear-gradient(#274b6d38,#0a202b);box-shadow:0 0 50px #7fb2dd20}.podium.p2{order:1;min-height:250px}.podium.p3{order:3;min-height:225px}.medal{font-size:38px}.avatar{font-size:68px;filter:drop-shadow(0 0 18px #5fddef55)}.podium small{color:var(--orange);font-weight:800}.podium h2{margin:5px 0}.podium p{margin:0;color:var(--muted);font-size:12px;letter-spacing:.08em}.board{overflow:hidden;border:1px solid #456b7855;border-radius:16px;background:#081923d9}.board header{display:flex;justify-content:space-between;gap:20px;padding:22px 24px;border-bottom:1px solid #53798844}.board h2{margin:0}.board header span{color:var(--muted)}table{width:100%;border-collapse:collapse}th,td{padding:14px 20px;border-bottom:1px solid #ffffff0b;text-align:left}th{color:#73939f;font-size:11px;text-transform:uppercase;letter-spacing:.1em}.mini-avatar{margin-right:10px;font-size:24px;vertical-align:middle}.champion{background:#274b6d38;color:#dcefff}.footer{padding:24px;text-align:center;color:#6e8994}.footer b{color:var(--cyan)}.champ-avatar svg{width:126px;height:126px}.podium .avatar svg{width:86px;height:86px}.mini-avatar svg{width:26px;height:26px;vertical-align:middle}.fallen svg{width:100%;height:100%;display:block}@media(max-width:700px){.hero{min-height:580px}.brand{left:16px;top:14px}.commentary{max-width:170px;padding:9px 11px;font-size:11px}.commentary.left{left:3%;top:10%}.commentary.right{right:3%;top:13%}.commentary b{font-size:14px}.throne{top:21%;width:215px;height:275px}.champ-avatar{font-size:80px}.throne h1{font-size:21px}.fallen-army{left:1%;right:1%;padding-inline:4px;gap:0}.fallen,.fallen:nth-child(4n){width:39px;height:39px;font-size:25px}.victory-word{font-size:86px}.podium-grid{grid-template-columns:1fr}.podium.p1,.podium.p2,.podium.p3{order:initial;min-height:0}.board{overflow:auto}th,td{padding:11px 13px;white-space:nowrap}}@media print{body{background:#07151e;print-color-adjust:exact}.page{width:100%;padding:0}.hero,.podium,.board{break-inside:avoid}}
  </style></head><body><main class="page"><section class="hero ${escapeHtml(ending.theme)}"><div class="brand">Ø ZEROSUM</div><div class="commentary left">${escapeHtml(ending.left)}</div><div class="commentary right">${report.players.length} ${escapeHtml(ending.rightLead)}<br><b>${escapeHtml(ending.rightBold)}</b></div><div class="throne"><span class="crown">${escapeHtml(ending.crown)}</span><div class="throne-back"></div><div class="champ-avatar">${champion ? fighterSvgMarkup(champion.player.avatar) : '🏆'}</div><h1>${escapeHtml(champion?.player.name ?? 'Champion')}</h1><small>THE LAST PLAYER STANDING</small></div><div class="fallen-army">${fallen}</div><div class="victory-word">ZERØSUM</div></section><section class="caption"><h2>${escapeHtml(champion?.player.name ?? 'Champion')} ${escapeHtml(ending.title)}</h2><p>“${escapeHtml(ending.quote)}”</p><span class="code">${escapeHtml(report.tournament.code)} · ${report.players.length} PLAYERS · ${report.tournament.round} ROUNDS</span></section><section class="podium-grid">${podium}</section><section class="board"><header><h2>Final leaderboard</h2><span>Ranked by bracket finish and match wins</span></header><table><thead><tr><th>Rank</th><th>Player</th><th>Wins</th><th>Finish</th></tr></thead><tbody>${rows}</tbody></table><div class="footer">Created with <b>ZEROSUM</b> · Bring the challenge. Outlast everyone.</div></section></main></body></html>`;
  const url = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `zerosum-${report.tournament.code}-leaderboard.html`;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function App() {
  const socket = useRef<WebSocket | null>(null);
  const connectionTimer = useRef<number | undefined>(undefined);
  const pollTimer = useRef<number | undefined>(undefined);
  const transport = useRef<'websocket' | 'http'>('websocket');
  const damageTimer = useRef<number | undefined>(undefined);
  const intentionalClose = useRef(false);
  const [mode, setMode] = useState<LandingMode>(initialUrlCode && !canResumeHost ? 'join' : 'choose');
  const [connected, setConnected] = useState(false);
  const [snapshot, setSnapshot] = useState<Snapshot>();
  useEffect(() => { if (!snapshot || snapshot.tournament.phase === 'COMPLETE' || snapshot.tournament.phase === 'CANCELLED') stopChargeSfx(); }, [snapshot?.tournament.phase, Boolean(snapshot)]);
  const [error, setError] = useState('');
  const [name, setName] = useState(localStorage.getItem('zerosum-name') ?? '');
  const [avatar, setAvatar] = useState(() => {
    const saved = localStorage.getItem('zerosum-avatar');
    if (saved && isValidAvatar(saved)) return saved;
    return playerAvatars[Math.floor(Math.random() * playerAvatars.length)];
  });
  const [code, setCode] = useState(initialUrlCode);
  const [hostToken, setHostToken] = useState(canResumeHost ? savedHostToken : '');
  const [isHost, setIsHost] = useState(canResumeHost);
  const [flawlessBonus, setFlawlessBonus] = useState(true);
  const [questionSeconds, setQuestionSeconds] = useState(20);
  const [arenaTone, setArenaTone] = useState<ArenaTone>('RESPECTFUL');
  const [hostPlay, setHostPlay] = useState(false);
  const [ladderLength, setLadderLength] = useState(10);
  const [feedbackMode, setFeedbackMode] = useState<'LEARN' | 'EXAM'>('LEARN');
  const [allowChallenge, setAllowChallenge] = useState(false);
  const [startingDifficulty, setStartingDifficulty] = useState('STANDARD');
  const [queuePosition, setQueuePosition] = useState<number>();
  const [sfxEnabled, setSfxEnabledState] = useState(() => localStorage.getItem('zerosum-sfx') !== 'off');
  const [soloLeaderboard, setSoloLeaderboard] = useState<Array<{ code: string; name: string; avatar: string; bankName: string; streak: number; ladderLength: number; result: string; endedAt: number }>>([]);
  const [openChallenges, setOpenChallenges] = useState<Array<{ code: string; streak: number; rivalIndex: number; ladderLength: number; bankId: string; bankName: string; playerName: string; playerAvatar: string }>>([]);
  const [recentWinners, setRecentWinners] = useState<RecentWinner[]>([]);
  const [championsOpen, setChampionsOpen] = useState(false);
  const [historyCode, setHistoryCode] = useState('');
  const [historyData, setHistoryData] = useState<TournamentHistory>();
  const [historyLoading, setHistoryLoading] = useState(false);
  const [questionSearch, setQuestionSearch] = useState('');
  const [avatarPickerOpen, setAvatarPickerOpen] = useState(false);
  const [progressionOpen, setProgressionOpen] = useState(false);
  const [spectatorBracketOpen, setSpectatorBracketOpen] = useState(false);
  const [spectatorBracket, setSpectatorBracket] = useState<MatchHistoryEntry[]>([]);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [confirmForfeit, setConfirmForfeit] = useState(false);
  const [answered, setAnswered] = useState<string>();
  const [remaining, setRemaining] = useState(20);
  const [lobbyRemaining, setLobbyRemaining] = useState(20 * 60);
  const [damageEffect, setDamageEffect] = useState<{ key: number; amount: number }>();
  const [account, setAccount] = useState<Account>();
  const [publicBeta, setPublicBeta] = useState(true);
  const [authenticated, setAuthenticated] = useState(false);
  const [canViewAnswers, setCanViewAnswers] = useState(false);
  const [canManagePacks, setCanManagePacks] = useState(false);
  const [banks, setBanks] = useState<BankSummary[]>([]);
  const [selectedBankId, setSelectedBankId] = useState('');
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [bankName, setBankName] = useState('');
  const [bankDescription, setBankDescription] = useState('');
  const [bankFile, setBankFile] = useState<File>();
  const [bankManagerView, setBankManagerView] = useState<BankManagerView>('library');
  const [draftQuestions, setDraftQuestions] = useState<DraftQuestion[]>(() => [createDraftQuestion(), createDraftQuestion(), createDraftQuestion()]);
  const [allowDuplicateQuestions, setAllowDuplicateQuestions] = useState(false);
  const [savingBank, setSavingBank] = useState(false);
  const [aiTopic, setAiTopic] = useState('');
  const [aiAudience, setAiAudience] = useState('Classroom learners');
  const [aiCount, setAiCount] = useState(12);
  const [aiSource, setAiSource] = useState('');
  const [aiBusy, setAiBusy] = useState(false);
  const [aiEnabled, setAiEnabled] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [aiFile, setAiFile] = useState<{ name: string; contentBase64: string }>();
  const [aiDocNote, setAiDocNote] = useState('');
  const [aiModel, setAiModel] = useState('muse-spark-1.3');
  const [copyStatus, setCopyStatus] = useState('Copy link');

  const handleMessage = useCallback((message: ServerMessage) => {
    if (message.type === 'error') return setError(message.message);
    if (message.type === 'report') {
      downloadTournamentReport(message);
      return;
    }
    if (message.type === 'leaderboard') {
      downloadLeaderboard(message);
      return;
    }
    if (message.type === 'progression') {
      setSpectatorBracket(message.matchHistory);
      setSpectatorBracketOpen(true);
      return;
    }
    if (message.type === 'created') {
      setCode(message.code);
      setHostToken(message.hostToken);
      setIsHost(true);
      if (message.playerToken && message.code) localStorage.setItem(playerTokenKey(message.code), message.playerToken);
      sessionStorage.setItem('zerosum-host-token', message.hostToken);
      sessionStorage.setItem('zerosum-host-code', message.code);
      history.replaceState({}, '', `?code=${message.code}`);
      return;
    }
    if (message.type === 'joined') {
      localStorage.setItem(playerTokenKey(message.code), message.playerToken);
      return;
    }
    if (message.type === 'soloCreated') {
      localStorage.setItem(playerTokenKey(message.code), message.playerToken);
      localStorage.setItem('zerosum-code', message.code);
      setCode(message.code);
      return;
    }
    if (message.type === 'queued') {
      localStorage.setItem('zerosum-queue-token', message.queueToken);
      setQueuePosition(message.position);
      return;
    }
    if (message.type === 'queueStatus') {
      if (message.status === 'WAITING') setQueuePosition(message.position);
      if (message.status === 'MATCHED' && message.code) {
        const token = localStorage.getItem('zerosum-queue-token') ?? '';
        localStorage.setItem(playerTokenKey(message.code), token);
        localStorage.setItem('zerosum-code', message.code);
        setCode(message.code);
        setQueuePosition(undefined);
      }
      if (message.status === 'EXPIRED') setQueuePosition(undefined);
      return;
    }
    if (message.type === 'challengeMatched') {
      const token = localStorage.getItem('zerosum-queue-token') ?? '';
      localStorage.setItem(playerTokenKey(message.code), token);
      localStorage.setItem('zerosum-code', message.code);
      setCode(message.code);
      setQueuePosition(undefined);
      return;
    }
    if (message.type === 'queueLeft') { setQueuePosition(undefined); return; }
    setSnapshot((previous) => {
      if (previous?.question?.nonce !== message.question?.nonce) setAnswered(undefined);
      if (previous?.me && message.me && message.me.hp < previous.me.hp) {
        window.clearTimeout(damageTimer.current);
        setDamageEffect({ key: Date.now(), amount: previous.me.hp - message.me.hp });
        damageTimer.current = window.setTimeout(() => setDamageEffect(undefined), 1800);
      }
      return message;
    });
  }, []);

  const refreshSoloBoards = useCallback(async () => {
    try {
      const [board, open] = await Promise.all([fetch('/api/solo/leaderboard', { cache: 'no-store' }), fetch('/api/solo/open', { cache: 'no-store' })]);
      if (board.ok) setSoloLeaderboard(((await board.json()).entries ?? []).filter((entry: { streak: number; result: string }) => entry.streak >= 2 && entry.result !== 'FORFEIT').slice(0, 5));
      if (open.ok) setOpenChallenges((await open.json()).open ?? []);
    } catch { /* boards are best-effort */ }
  }, []);

  const refreshRecentWinners = useCallback(async () => {
    try {
      const winners = await fetch('/api/tournaments/recent-winners', { cache: 'no-store' });
      if (winners.ok) setRecentWinners(((await winners.json()).entries ?? []).slice(0, 10));
    } catch { /* champions board is best-effort */ }
  }, []);
  async function openHistory(codeToView: string) {
    playSfx('click');
    setHistoryCode(codeToView);
    setHistoryData(undefined);
    setHistoryLoading(true);
    try {
      const response = await fetch(`/api/tournaments/${encodeURIComponent(codeToView)}/history`, { cache: 'no-store' });
      if (response.ok) setHistoryData(await response.json() as TournamentHistory);
    } catch { /* history is best-effort */ } finally { setHistoryLoading(false); }
  }

  useEffect(() => {
    void refreshSoloBoards();
    const timer = window.setInterval(() => { if (!snapshot) void refreshSoloBoards(); }, 5000);
    return () => window.clearInterval(timer);
  }, [refreshSoloBoards, snapshot, snapshot?.tournament.phase]);

  useEffect(() => {
    void refreshRecentWinners();
    const timer = window.setInterval(() => { void refreshRecentWinners(); }, 60000);
    return () => window.clearInterval(timer);
  }, [refreshRecentWinners]);

  const httpRequest = useCallback(async (path: '/api/action' | '/api/sync', body: Record<string, unknown>) => {
    const response = await fetch(path, {
      method: 'POST', cache: 'no-store',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const result = await response.json() as { messages?: ServerMessage[] };
    for (const message of result.messages ?? []) handleMessage(message);
    if (!response.ok && !(result.messages?.length)) throw new Error('The game server rejected the request.');
    return response.ok;
  }, [handleMessage]);

  const startHttpFallback = useCallback(() => {
    if (transport.current === 'http') return;
    transport.current = 'http';
    window.clearTimeout(connectionTimer.current);
    socket.current?.close();

    const poll = async () => {
      if (intentionalClose.current) return;
      try {
        const savedToken = sessionStorage.getItem('zerosum-host-token');
        const savedCode = sessionStorage.getItem('zerosum-host-code');
        const playerCode = localStorage.getItem('zerosum-code');
        let ok = true;
        if (savedToken && savedCode) ok = await httpRequest('/api/sync', { code: savedCode, hostToken: savedToken });
        else if (playerCode) ok = await httpRequest('/api/sync', { code: playerCode, playerId: clientId, playerToken: savedPlayerToken(playerCode) });
        else {
          const health = await fetch('/api/health', { cache: 'no-store' });
          if (!health.ok) throw new Error('Game server is unavailable.');
        }
        setConnected(true);
        if (ok) setError('');
      } catch {
        setConnected(false);
        setError('The game connection was interrupted. Retrying…');
      } finally {
        if (!intentionalClose.current) pollTimer.current = window.setTimeout(poll, 1000);
      }
    };
    void poll();
  }, [httpRequest]);

  const send = useCallback((action: string, payload: Record<string, unknown> = {}) => {
    if (transport.current === 'websocket' && socket.current?.readyState === WebSocket.OPEN) {
      socket.current.send(JSON.stringify({ action, ...payload }));
      return;
    }
    if (transport.current === 'http') {
      void httpRequest('/api/action', { action, ...payload }).then((ok) => {
        setConnected(true);
        if (ok) setError('');
      }).catch(() => {
        setConnected(false);
        setError('The game connection was interrupted. Retrying…');
      });
      return;
    }
    setError('Still connecting. Please try again.');
  }, [httpRequest]);

  const loadBanks = useCallback(async () => {
    const response = await fetch('/api/banks', { cache: 'no-store' });
    if (!response.ok) return;
    const result = await response.json() as { banks: BankSummary[] };
    setBanks(result.banks);
    setSelectedBankId((current) => result.banks.some((bank) => bank.id === current)
      ? current
      : result.banks.find((bank) => bank.gameMode !== 'RPS' && bank.isSample)?.id ?? result.banks.find((bank) => bank.gameMode !== 'RPS')?.id ?? result.banks[0]?.id ?? '');
  }, []);

  const connect = useCallback(async () => {
    try {
      const configResponse = await fetch('/api/config', { cache: 'no-store' });
      if (!configResponse.ok) throw new Error('Game configuration is unavailable.');
      const { websocketUrl, publicBeta: betaEnabled } = await configResponse.json() as { websocketUrl: string; publicBeta?: boolean };
      setPublicBeta(Boolean(betaEnabled));
      const ws = new WebSocket(websocketUrl);
      socket.current = ws;
      connectionTimer.current = window.setTimeout(() => {
        if (ws.readyState !== WebSocket.OPEN) startHttpFallback();
      }, 3500);
      ws.onopen = () => {
        if (transport.current !== 'websocket') return ws.close();
        window.clearTimeout(connectionTimer.current);
        setConnected(true);
        setError('');
        const savedHostToken = sessionStorage.getItem('zerosum-host-token');
        const savedHostCode = sessionStorage.getItem('zerosum-host-code');
        const urlCode = new URLSearchParams(location.search).get('code')?.toUpperCase();
        if (savedHostToken && urlCode && (!savedHostCode || savedHostCode === urlCode)) send('hostResume', { code: urlCode, hostToken: savedHostToken });
        else if (urlCode && localStorage.getItem('zerosum-code') === urlCode && localStorage.getItem('zerosum-name')) {
          send('join', {
            code: localStorage.getItem('zerosum-code'),
            name: localStorage.getItem('zerosum-name'),
            avatar: localStorage.getItem('zerosum-avatar') ?? playerAvatars[0],
            playerId: clientId,
            playerToken: savedPlayerToken(localStorage.getItem('zerosum-code') ?? ''),
          });
        }
      };
      ws.onmessage = (event) => handleMessage(JSON.parse(event.data) as ServerMessage);
      ws.onclose = () => {
        if (!intentionalClose.current && transport.current === 'websocket') startHttpFallback();
      };
      ws.onerror = () => {
        setError('Switching to classroom compatibility mode…');
        startHttpFallback();
      };
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not connect.');
      startHttpFallback();
    }
  }, [handleMessage, send, startHttpFallback]);

  useEffect(() => {
    connect();
    void fetch('/api/me', { cache: 'no-store' }).then((response) => response.json()).then((result: { account: Account | null; publicBeta?: boolean; authenticated?: boolean; canViewAnswers?: boolean; canManagePacks?: boolean; aiEnabled?: boolean; aiModel?: string; isAdmin?: boolean }) => {
      setPublicBeta(Boolean(result.publicBeta));
      setAuthenticated(Boolean(result.authenticated));
      setCanViewAnswers(Boolean(result.canViewAnswers));
      setCanManagePacks(Boolean(result.canManagePacks));
      setAiEnabled(Boolean(result.aiEnabled)); setIsAdmin(Boolean(result.isAdmin || result.account?.isAdmin)); if (result.aiModel) setAiModel(result.aiModel);
      if (result.account) {
        setAccount(result.account);
        void loadBanks();
      }
    });
    return () => {
      intentionalClose.current = true;
      clearTimeout(connectionTimer.current);
      clearTimeout(pollTimer.current);
      clearTimeout(damageTimer.current);
      socket.current?.close();
    };
  }, []); // Connect only once; blocked WebSockets automatically switch to ordinary HTTP.

  useEffect(() => {
    const deadline = snapshot?.question?.deadline;
    if (!deadline) return setRemaining(0);
    const update = () => setRemaining(Math.max(0, Math.ceil((deadline - Date.now()) / 1000)));
    update();
    const timer = window.setInterval(update, 200);
    return () => clearInterval(timer);
  }, [snapshot?.question?.nonce, snapshot?.question?.deadline]);

  useEffect(() => {
    const expiresAt = snapshot?.tournament.lobbyExpiresAt;
    if (!expiresAt) return setLobbyRemaining(0);
    const update = () => setLobbyRemaining(Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000)));
    update();
    const timer = window.setInterval(update, 1000);
    return () => clearInterval(timer);
  }, [snapshot?.tournament.lobbyExpiresAt]);

  useEffect(() => {
    if (!['COMPLETE', 'CANCELLED'].includes(snapshot?.tournament.phase ?? '')) return;
    localStorage.removeItem('zerosum-code');
    sessionStorage.removeItem('zerosum-host-token');
    sessionStorage.removeItem('zerosum-host-code');
    if (location.search) history.replaceState({}, '', location.pathname);
  }, [snapshot?.tournament.phase]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!snapshot?.question || answered || remaining === 0) return;
      const index = ['a', 'b', 'c', 'd'].indexOf(event.key.toLowerCase());
      if (index >= 0 && index < snapshot.question.options.length) answer(index);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [snapshot?.question?.nonce, answered, remaining]);

  const me = snapshot?.me;
  const musicScene: MusicScene = snapshot?.tournament.phase === 'COMPLETE' && me?.status === 'CHAMPION'
    ? 'off'
    : snapshot?.tournament.phase === 'IN_ROUND'
      ? me?.status === 'ELIMINATED' ? 'spectator' : 'battle'
      : snapshot ? snapshot.tournament.phase === 'COMPLETE' ? 'spectator' : 'lobby' : 'menu';
  const music = useBackgroundMusic(musicScene);
  const withMusic = (screen: React.ReactNode) => <>{screen}{musicScene !== 'off' && <><MusicControl enabled={music.enabled} playing={music.playing} onToggle={music.toggle}/><button type="button" className={`sfx-control ${sfxEnabled ? 'playing' : 'muted'}`} aria-label={sfxEnabled ? 'Mute sound effects' : 'Unmute sound effects'} aria-pressed={sfxEnabled} title={sfxEnabled ? 'Mute sound effects' : 'Unmute sound effects'} onClick={() => { const next = !sfxEnabled; setSfxEnabledState(next); localStorage.setItem('zerosum-sfx', next ? 'on' : 'off'); if (!next) stopChargeSfx(); else playSfx('click'); }}><span aria-hidden="true">🔊</span></button></>}</>;
  const myMatch = snapshot?.matches.find((match) => match.id === me?.matchId);
  const opponents = useMemo(() => myMatch?.aliveIds.filter((id) => id !== me?.id) ?? [], [myMatch, me?.id]);
  const filteredQuestions = useMemo(() => {
    const query = questionSearch.trim().toLowerCase();
    if (!query) return snapshot?.questionBank ?? [];
    return (snapshot?.questionBank ?? []).filter((question) =>
      `${question.id} ${questionLabel(question)} ${question.text} ${question.options.join(' ')}`.toLowerCase().includes(query));
  }, [snapshot?.questionBank, questionSearch]);
  const customBankCount = banks.filter((bank) => !bank.isSample).length;
  const selectedArenaTone = arenaToneOptions.find((option) => option.id === arenaTone) ?? arenaToneOptions[0];

  function join(event: FormEvent) {
    event.preventDefault();
    const normalizedCode = code.trim().toUpperCase();
    const normalizedName = name.trim();
    if (!normalizedName || normalizedCode.length !== 6) return setError('Enter your name and the six-character code.');
    localStorage.setItem('zerosum-name', normalizedName);
    localStorage.setItem('zerosum-code', normalizedCode);
    localStorage.setItem('zerosum-avatar', avatar);
    history.replaceState({}, '', `?code=${normalizedCode}`);
    send('join', { code: normalizedCode, name: normalizedName, avatar, playerId: clientId, playerToken: savedPlayerToken(normalizedCode) });
  }

  function createTournament() {
    setError('');
    setConfirmCancel(false);
    setProgressionOpen(false);
    setSpectatorBracketOpen(false);
    setSpectatorBracket([]);
    setReviewOpen(false);
    if (!selectedBankId) return setError('Select a challenge pack before creating the tournament.');
    send('createTournament', { flawlessBonus, questionSeconds, arenaTone, bankId: selectedBankId, hostPlay, hostName: name || account?.displayName, hostAvatar: avatar, hostPlayerId: clientId });
  }

  async function signIn(event: FormEvent) {
    event.preventDefault();
    setError('');
    const response = await fetch('/api/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: loginEmail, password: loginPassword }),
    });
    const result = await response.json() as { account?: Account; authenticated?: boolean; canViewAnswers?: boolean; canManagePacks?: boolean; error?: string };
    if (!response.ok || !result.account) return setError(result.error ?? 'Unable to sign in.');
    setAccount(result.account);
    setAuthenticated(Boolean(result.authenticated));
    setCanViewAnswers(Boolean(result.canViewAnswers));
    setCanManagePacks(Boolean(result.canManagePacks));
    setIsAdmin(Boolean(result.account?.isAdmin));
    setLoginPassword('');
    await loadBanks();
    try { const me = await (await fetch('/api/me', { cache: 'no-store' })).json() as { aiEnabled?: boolean; aiModel?: string; isAdmin?: boolean }; setAiEnabled(Boolean(me.aiEnabled)); setIsAdmin(Boolean(me.isAdmin)); if (me.aiModel) setAiModel(me.aiModel); } catch { /* AI flags refresh is best-effort */ }
    startHttpFallback();
    setMode('choose');
  }

  async function signOut() {
    const currentTournament = snapshot?.tournament;
    const phase = currentTournament?.phase;
    if (phase === 'IN_ROUND' || phase === 'ROUND_BREAK') {
      setError('Finish the tournament before signing out so the class does not lose its host controls.');
      return;
    }
    if (phase === 'LOBBY' && currentTournament) {
      if (!window.confirm('Signing out will terminate this unstarted tournament and retire its join code. Continue?')) return;
      const cancellation = await fetch('/api/action', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'cancelTournament', code: currentTournament.code, hostToken }),
      });
      if (!cancellation.ok) {
        setError('Could not terminate the lobby. Try again before signing out.');
        return;
      }
    }
    if (snapshot) returnHome();
    await fetch('/api/auth/logout', { method: 'POST' });
    const response = await fetch('/api/me', { cache: 'no-store' });
    const result = await response.json() as { account: Account | null; authenticated?: boolean; canViewAnswers?: boolean; canManagePacks?: boolean };
    setAccount(result.account ?? undefined);
    setAuthenticated(Boolean(result.authenticated));
    setCanViewAnswers(Boolean(result.canViewAnswers));
    setCanManagePacks(Boolean(result.canManagePacks)); setIsAdmin(Boolean((result as { isAdmin?: boolean }).isAdmin || result.account?.isAdmin)); setAiEnabled(false);
    await loadBanks();
    setMode('choose');
  }

  async function generateAiPack(event: FormEvent) {
    event.preventDefault();
    if (!aiTopic.trim() && !aiFile) return setError('Tell the AI what topic to teach, or upload a lesson document.');
    setAiBusy(true); setError('');
    try {
      const response = await fetch('/api/ai/generate-pack', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ topic: aiTopic, audience: aiAudience, count: aiCount, sourceText: aiSource, sourceFile: aiFile }) });
      const result = await response.json() as { bank?: BankSummary; error?: string; model?: string; document?: { pages: number; characters: number; fileName: string } };
      if (!response.ok || !result.bank) { setError(result.error ?? 'AI Pack Forge could not create that pack.'); return; }
      await loadBanks(); setSelectedBankId(result.bank.id); setAiTopic(''); setAiSource(''); setAiFile(undefined); setAiDocNote(result.document ? 'Read ' + result.document.pages + ' page(s), ' + result.document.characters.toLocaleString() + ' characters from ' + result.document.fileName + '.' : ''); setMode('host'); playSfx('charge');
    } catch { setError('Could not reach the AI Pack Forge. Check your connection and try again.'); }
    finally { setAiBusy(false); }
  }

  async function submitBank(payload: Record<string, unknown>) {
    if (!canManagePacks) {
      setError('Creating and importing challenge packs requires a signed-in paid host during public beta.');
      return false;
    }
    setSavingBank(true);
    setError('');
    try {
      const response = await fetch('/api/banks/import', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      });
      const result = await response.json() as { bank?: BankSummary; error?: string };
      if (!response.ok || !result.bank) {
        setError(result.error ?? 'Unable to create that challenge pack.');
        return false;
      }
      await loadBanks();
      setSelectedBankId(result.bank.id);
      setBankName('');
      setBankDescription('');
      setBankFile(undefined);
      setDraftQuestions([createDraftQuestion(), createDraftQuestion(), createDraftQuestion()]);
      setAllowDuplicateQuestions(false);
      setBankManagerView('library');
      return true;
    } catch {
      setError('Could not reach Zerosum. Check your connection and try again.');
      return false;
    } finally {
      setSavingBank(false);
    }
  }

  async function saveManualBank(event: FormEvent) {
    event.preventDefault();
    if (!bankName.trim()) return setError('Give your challenge pack a name.');
    if (draftQuestions.some((question) => !question.prompt.trim())) return setError('Add a question to every question card.');
    if (draftQuestions.some((question) => question.options.some((option) => !option.trim()))) return setError('Complete every answer choice, or remove unused choices.');
    const created = await submitBank({
      name: bankName,
      description: bankDescription,
      allowDuplicates: allowDuplicateQuestions,
      questions: draftQuestions.map(({ prompt, options, correctIndex, explanation, difficulty }) => ({ prompt, options, correctIndex, explanation, difficulty })),
    });
    if (created) setMode('host');
  }

  function updateDraftQuestion(id: string, changes: Partial<DraftQuestion>) {
    setDraftQuestions((questions) => questions.map((question) => question.id === id ? { ...question, ...changes } : question));
  }

  function updateDraftOption(id: string, optionIndex: number, value: string) {
    setDraftQuestions((questions) => questions.map((question) => question.id === id
      ? { ...question, options: question.options.map((option, index) => index === optionIndex ? value : option) }
      : question));
  }

  function removeDraftOption(id: string, optionIndex: number) {
    setDraftQuestions((questions) => questions.map((question) => {
      if (question.id !== id || question.options.length <= 2) return question;
      const options = question.options.filter((_, index) => index !== optionIndex);
      const correctIndex = question.correctIndex === optionIndex ? 0 : question.correctIndex > optionIndex ? question.correctIndex - 1 : question.correctIndex;
      return { ...question, options, correctIndex };
    }));
  }

  function duplicateDraftQuestion(id: string) {
    setDraftQuestions((questions) => {
      if (questions.length >= (account?.limits.questionsPerBank ?? 0)) return questions;
      const index = questions.findIndex((question) => question.id === id);
      if (index < 0) return questions;
      const source = questions[index];
      const copy = { ...source, id: createClientId(), options: [...source.options] };
      return [...questions.slice(0, index + 1), copy, ...questions.slice(index + 1)];
    });
    setAllowDuplicateQuestions(true);
  }

  async function importBank(event: FormEvent) {
    event.preventDefault();
    if (!bankFile || !bankName.trim()) return setError('Choose a JSON or CSV file and give the pack a name.');
    if (bankFile.size > 1024 * 1024) return setError('Challenge-pack files must be 1 MB or smaller.');
    const format = bankFile.name.toLowerCase().endsWith('.csv') ? 'csv' : bankFile.name.toLowerCase().endsWith('.json') ? 'json' : '';
    if (!format) return setError('Only .json and .csv files are supported.');
    const created = await submitBank({ name: bankName, description: bankDescription, format, content: await bankFile.text() });
    if (created) setMode('host');
  }

  function downloadTemplate(format: 'json' | 'csv') {
    const json = { name: 'My Challenge Pack', description: 'Optional description', questions: [
      { prompt: 'The example statement is true.', options: ['True', 'False'], correctIndex: 0, explanation: 'Explain the answer.', difficulty: 'basic', tags: ['example'] },
      { prompt: 'Choose the correct answer.', options: ['Option A', 'Option B', 'Option C', 'Option D'], correctIndex: 1, explanation: 'Option B is correct.', difficulty: 'basic', tags: ['example'] },
      { prompt: 'Add at least three questions.', options: ['Yes', 'No'], correctIndex: 0, explanation: 'Three is the minimum.', difficulty: 'basic', tags: [] },
    ] };
    const content = format === 'json' ? JSON.stringify(json, null, 2) : 'question,optionA,optionB,optionC,optionD,correctIndex,explanation,difficulty,tags\n"The example statement is true.",True,False,,,0,"Explain the answer.",basic,example\n"Choose the correct answer.","Option A","Option B","Option C","Option D",1,"Option B is correct.",basic,example\n"Add at least three questions.",Yes,No,,,0,"Three is the minimum.",basic,example';
    const url = URL.createObjectURL(new Blob([content], { type: format === 'json' ? 'application/json' : 'text/csv' }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = `zerosum-challenge-pack-template.${format}`; anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function returnHome() {
    const currentPlayerCode = snapshot?.tournament.code ?? localStorage.getItem('zerosum-code') ?? code;
    if (currentPlayerCode) localStorage.removeItem(playerTokenKey(currentPlayerCode));
    localStorage.removeItem('zerosum-code');
    sessionStorage.removeItem('zerosum-host-token');
    sessionStorage.removeItem('zerosum-host-code');
    history.replaceState({}, '', location.pathname);
    setSnapshot(undefined);
    setCode('');
    setHostToken('');
    setIsHost(false);
    setMode('choose');
    setAnswered(undefined);
    setDamageEffect(undefined);
    setConfirmCancel(false);
    setProgressionOpen(false);
    setSpectatorBracketOpen(false);
    setSpectatorBracket([]);
    setReviewOpen(false);
    setError('');
  }

  async function copyJoinLink() {
    const link = `${location.origin}?code=${code}`;
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard API unavailable');
      await navigator.clipboard.writeText(link);
    } catch {
      const field = document.createElement('textarea');
      field.value = link;
      field.style.position = 'fixed';
      field.style.opacity = '0';
      document.body.appendChild(field);
      field.select();
      document.execCommand('copy');
      field.remove();
    }
    setCopyStatus('Copied!');
    window.setTimeout(() => setCopyStatus('Copy link'), 1600);
  }

  function downloadReport() {
    send('requestReport', { code, hostToken });
  }

  function viewPlayerBracket() {
    setSpectatorBracketOpen(true);
    const gameCode = snapshot?.tournament.code ?? code;
    send('requestProgression', { code: gameCode, playerId: clientId, playerToken: savedPlayerToken(gameCode) });
  }

  function downloadShareableLeaderboard() {
    send('requestLeaderboard', isHost
      ? { code: snapshot?.tournament.code ?? code, hostToken }
      : { code: snapshot?.tournament.code ?? code, playerId: clientId, playerToken: savedPlayerToken(snapshot?.tournament.code ?? code) });
  }

  function answer(optionIndex: number) {
    if (!snapshot?.question || answered) return;
    playSfx('charge');
    setAnswered(snapshot.question.nonce);
    send('answer', { code: snapshot.tournament.code, playerId: clientId, playerToken: savedPlayerToken(snapshot.tournament.code), nonce: snapshot.question.nonce, optionIndex });
  }

  if (!snapshot && (!isHost || !hostToken)) {
    return withMusic(<main className="shell landing">
      <header className="site-header">
        <div className="brand"><span className="cloud-mark">Ø</span><span>ZEROSUM</span></div>
        <AccountBadge account={account} publicBeta={publicBeta} authenticated={authenticated} onSignIn={() => setMode('login')} onHost={account && mode !== 'host' ? () => setMode('host') : undefined} onSignOut={authenticated ? signOut : undefined} />
      </header>
      <section className="hero">
        <div className="eyebrow">LEARNING, MADE FUN</div>
        <h1>Learn it. Play it.<br/><em>Outlast everyone.</em></h1>
        <p>ZeroSum Arena turns quizzes into live battle games. Answer correctly to charge up and strike — built for classroom reviews, practice exams, and learning while you play. Accuracy keeps you alive, and speed wins the round.</p>
        <div className="feature-chips"><span>⚡ Live duels</span><span>♥ 3 HP</span><span>🏆 One champion</span></div>
      </section>
      {mode === 'choose' && <div className="choice-grid">
        <button className="choice primary" onClick={() => setMode('join')}><span>⚔</span><b>Join the clash</b><small>Enter your instructor’s game code</small></button>
        <button className="choice" onClick={() => setMode(publicBeta || account ? 'host' : 'login')}><span className="choice-icon host-icon" aria-hidden="true"><svg viewBox="0 0 48 48" role="presentation"><path d="M14 6h20v6h6v4c0 5-3.6 9.3-8.4 10.3A12 12 0 0 1 27 30.9V36h5v6H16v-6h5v-5.1a12 12 0 0 1-4.6-4.6C11.6 25.3 8 21 8 16v-4h4" fill="none" stroke="currentColor" strokeWidth="3" strokeLinejoin="round"/><path d="M14 12H8v4c0 3.4 2.6 6.2 6 6.9M34 12h6v4c0 3.4-2.6 6.2-6 6.9" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"/></svg></span><b>Host a tournament</b><small>{publicBeta ? 'Public beta · up to 50 players' : account ? `Signed in as ${account.displayName}` : 'A host account is required'}</small></button>
        <button className="choice" onClick={() => setMode('solo')}><span>🔥</span><b>Solo Arcade</b><small>Tekken-style bot ladder · build your win streak</small></button>
        <button className="choice" onClick={() => setMode('challenge')}><span>⚔</span><b>Challenge a streak</b><small>Queue up and take the next rival slot</small></button>
      </div>}
      {mode === 'choose' && <section className="streak-panel"><FighterAvatar seed={avatar} /><span>👤 {name || 'Guest fighter'}</span><strong>Finish a Solo Arcade run and your name lands on the leaderboard below — tagged with your session code.</strong></section>}
      {mode === 'choose' && isAdmin && authenticated && <section className="board-card ai-home"><div className="section-title"><div><div className="eyebrow">ADMIN TESTING · META MUSE SPARK</div><h2>AI Pack Forge</h2></div><span>{aiEnabled ? 'AI online' : 'AI key needed'}</span></div><p className="muted">Signed in as admin: type a topic, paste lesson notes, or upload a PDF and Meta AI will forge a checked, playable quiz pack.</p><button type="button" className="action" onClick={() => { setBankManagerView('ai'); setMode('banks'); playSfx('click'); }}>Open AI Pack Forge ✦</button></section>}
      {mode === 'choose' && !(isAdmin && authenticated) && <section className="board-card ai-home"><div className="section-title"><div><div className="eyebrow">READY-MADE LEARNING LIBRARY</div><h2>Start learning in one click</h2></div><span>11 packs · 300+ questions</span></div><p className="muted">Math, English, Science, Philippine History, Money Smart, Job Ready, Cybersecurity, and AWS - every pack includes teaching explanations. Pick one in Solo Arcade or host a tournament for your class.</p><button type="button" className="action" onClick={() => { setMode('solo'); playSfx('click'); }}>Play Solo Arcade</button></section>}
      {mode === 'choose' && <section className="board-card"><div className="section-title"><div><div className="eyebrow">LIVE · OPEN TO CHALLENGERS</div><h2>Streaks you can challenge right now</h2></div><span>{openChallenges.length} live</span></div>{openChallenges.length ? <div className="open-list">{openChallenges.map((open) => <article key={open.code}><FighterAvatar seed={open.playerAvatar} /><div><b>{open.playerName} <small>#{open.code}</small></b><span>🎒 {open.bankName} · 🔥 streak {open.streak} · rival {open.rivalIndex}/{open.ladderLength}</span></div><button type="button" onClick={() => { setSelectedBankId(open.bankId); setMode('challenge'); playSfx('click'); }}>Challenge ⚔</button></article>)}</div> : <p className="muted">No streak is open to challengers at the moment. Start a Solo Arcade run with “Allow challenges” to appear here.</p>}</section>}
      {mode === 'choose' && <section className="board-card"><div className="section-title"><div><div className="eyebrow">SOLO LEADERBOARD</div><h2>Top streaks</h2></div><span>Updated live</span></div>{soloLeaderboard.length ? <ol className="leaderboard-list">{soloLeaderboard.slice(0, 5).map((entry, index) => <li key={entry.code}><b>#{index + 1}</b><FighterAvatar seed={entry.avatar} /><span className="board-name">{entry.name} <small>#{entry.code}</small></span><span className="board-bank">{entry.bankName}</span><strong>🔥 {entry.streak}</strong><em>{entry.result === 'LADDER_CLEARED' ? '👑 Cleared' : entry.result === 'CHALLENGED' ? '⚔ Challenged' : entry.result === 'FORFEIT' ? '🏳 Forfeited' : '💥 Ended'}</em></li>)}</ol> : <p className="muted">No finished streaks yet — be the first name on this board.</p>}</section>}
      {mode === 'choose' && <section className="board-card champions-card"><div className="section-title"><div><div className="eyebrow">HOSTED TOURNAMENTS</div><h2>Recent champions</h2></div><span>Last 10 battles</span></div>{recentWinners.length ? <> <ol className="leaderboard-list winners-list">{recentWinners.slice(0, championsOpen ? 10 : 3).map((winner, index) => <li key={winner.code}><button type="button" className="winner-row" onClick={() => void openHistory(winner.code)}><b>#{index + 1}</b><FighterAvatar seed={winner.championAvatar} /><span className="board-name">{winner.championName} <small>#{winner.code}</small></span><span className="board-bank">{winner.bankName}</span><strong>{winner.playerCount} players · {winner.rounds} rounds</strong><em>{new Date(winner.endedAt).toLocaleDateString()}</em></button></li>)}</ol>{recentWinners.length > 3 && <button type="button" className="champions-toggle" aria-expanded={championsOpen} onClick={() => { setChampionsOpen((value) => !value); playSfx('click'); }}><span>{championsOpen ? 'Show top 3' : `View all ${recentWinners.length} battles`}</span><span className="champions-chevron" aria-hidden="true">{championsOpen ? '▴' : '▾'}</span></button>}</> : <p className="muted">No hosted tournament has crowned a champion yet — host one and finish it to appear here. Click a champion to see the final standings.</p>}</section>}
      {historyCode && <div className="avatar-modal" role="dialog" aria-modal="true" aria-label="Tournament history" onClick={() => setHistoryCode('')}><section onClick={(event) => event.stopPropagation()}><header><div><div className="eyebrow">TOURNAMENT HISTORY · #{historyCode}</div><h2>{historyData?.bankName || 'Hosted tournament'}</h2></div><button type="button" aria-label="Close history" onClick={() => setHistoryCode('')}>×</button></header>{historyLoading || !historyData ? <p className="muted">Loading tournament history…</p> : <><div className="history-champion"><FighterAvatar seed={historyData.champion?.avatar ?? 'arena-01'} large /><div><small>CHAMPION</small><strong>{historyData.champion?.name ?? 'No champion'}</strong><span>{historyData.rounds} rounds · {historyData.playerCount} players · {historyData.phase}</span></div></div><h3 className="history-heading">Final standings</h3><ol className="leaderboard-list">{historyData.players.map((player, index) => <li key={player.id}><b>#{index + 1}</b><FighterAvatar seed={player.avatar} /><span className="board-name">{player.name}</span><strong>{player.status === 'CHAMPION' ? '👑 Champion' : `♥ ${player.hp} HP`}</strong></li>)}</ol></>}</section></div>}
      {mode === 'choose' && <section className="rules-card">
        <div className="rules-heading"><div><div className="eyebrow">BATTLE BRIEFING</div><h2>How to play</h2></div><span>Accuracy first. Speed breaks the tie.</span></div>
        <div className="rule-steps">
          <article><b>1</b><div><strong>Join with 3 HP</strong><p>Enter the six-character code. Your remaining health carries into every later round.</p></div></article>
          <article><b>2</b><div><strong>Answer before time expires</strong><p>Both players receive the same challenge. Once selected, an answer is locked.</p></div></article>
          <article><b>3</b><div><strong>Survive your duel</strong><p>Reach 0 HP and you are eliminated. Winners wait while the instructor prepares the next round.</p></div></article>
        </div>
        <div className="damage-rules">
          <div><span>Both correct</span><strong>Fastest correct is safe; the slower player loses 1 HP.</strong></div>
          <div><span>One correct</span><strong>The correct player is safe; the wrong player loses 1 HP—even if they clicked first.</strong></div>
          <div className="warning"><span>Both wrong / timeout</span><strong>Everyone loses 1 HP. A fast wrong answer never wins.</strong></div>
          <div><span>Three-player clash</span><strong>The fastest correct player is safe; both opponents lose 1 HP.</strong></div>
        </div>
      </section>}
      {mode === 'join' && <form className="panel entry-form" onSubmit={join}>
        <button type="button" className="back" onClick={() => setMode('choose')}>← Back</button>
        <label>Display name<input autoFocus maxLength={24} value={name} onChange={(event) => setName(event.target.value)} placeholder="Cloud champion" /></label>
        <div className="avatar-choice"><span className="avatar-preview" aria-label="Selected fighter"><FighterAvatar seed={avatar} /></span><div><strong>Your fighter</strong><small>Pick your battle character</small></div><button type="button" onClick={() => setAvatarPickerOpen(true)}>Choose fighter</button></div>
        <label>Game code<input className="code-input" maxLength={6} value={code} onChange={(event) => setCode(event.target.value.toUpperCase())} placeholder="ABC123" /></label>
        <button className="action" disabled={!connected}>Enter arena</button>
        {avatarPickerOpen && <div className="avatar-modal" role="dialog" aria-modal="true" aria-label="Choose your avatar" onClick={() => setAvatarPickerOpen(false)}><section onClick={(event) => event.stopPropagation()}><header><div><div className="eyebrow">CHOOSE YOUR FIGHTER</div><h2>Choose your colors</h2></div><button type="button" aria-label="Close avatar gallery" onClick={() => setAvatarPickerOpen(false)}>×</button></header><FighterThemePicker current={avatar} onApply={(v) => { setAvatar(v); setAvatarPickerOpen(false); playSfx('click'); }} /></section></div>}
      </form>}
      {mode === 'solo' && <div className="panel entry-form">
        <button type="button" className="back" onClick={() => setMode('choose')}>← Back</button>
        <div className="eyebrow">SOLO ARCADE</div><h2>Build your win streak</h2>
        <p className="muted">Duel bot rivals one at a time. Win to climb, lose and the streak ends. HP resets every duel.</p>
        <label>Fighter handle<input autoFocus maxLength={24} value={name} onChange={(event) => setName(event.target.value)} placeholder="Cloud champion" /></label>
        <div className="avatar-choice"><span className="avatar-preview" aria-label="Selected fighter"><FighterAvatar seed={avatar} /></span><div><strong>Your fighter</strong><small>Pick your battle character</small></div><button type="button" onClick={() => setAvatarPickerOpen(true)}>Choose fighter</button></div>
        {avatarPickerOpen && <div className="avatar-modal" role="dialog" aria-modal="true" aria-label="Choose your fighter" onClick={() => setAvatarPickerOpen(false)}><section onClick={(event) => event.stopPropagation()}><header><div><div className="eyebrow">CHOOSE YOUR FIGHTER</div><h2>Choose your colors</h2></div><button type="button" aria-label="Close fighter gallery" onClick={() => setAvatarPickerOpen(false)}>×</button></header><FighterThemePicker current={avatar} onApply={(v) => { setAvatar(v); setAvatarPickerOpen(false); playSfx('click'); }} /></section></div>}
        <p className="muted">When your run ends, your result joins the Solo Leaderboard as <b>{name || 'Your name'} #SESSION</b>.</p>
        <label>Challenge pack<select value={selectedBankId} onChange={(event) => setSelectedBankId(event.target.value)}>{banks.map((bank) => <option key={bank.id} value={bank.id}>{bank.isSample ? 'Included · ' : ''}{bank.name}</option>)}</select>{!banks.length && <small>Sign-in/beta access loads the included packs.</small>}</label>
        <label>Ladder length<select value={ladderLength} onChange={(event) => setLadderLength(Number(event.target.value))}>{[5, 10, 25, 50].map((value) => <option key={value} value={value}>{value} rivals</option>)}</select></label>
        <label>Starting difficulty<select value={startingDifficulty} onChange={(event) => setStartingDifficulty(event.target.value)}><option value="ROOKIE">Rookie (gentler)</option><option value="STANDARD">Standard escalation</option><option value="EXPERT">Expert (harder)</option></select><small>Rivals get faster and more accurate as your streak climbs.</small></label>
        <label>Feedback mode<select value={feedbackMode} onChange={(event) => setFeedbackMode(event.target.value as 'LEARN' | 'EXAM')}><option value="LEARN">Learn — explanation after each question</option><option value="EXAM">Exam — review only at the end</option></select></label>
        <label>Seconds per question<select value={questionSeconds} onChange={(event) => setQuestionSeconds(Number(event.target.value))}>{[20, 25, 30, 45, 60, 90, 120].map((seconds) => <option key={seconds} value={seconds}>{seconds} seconds</option>)}</select></label>
        <div className="setup-option"><label className="toggle"><input type="checkbox" checked={allowChallenge} onChange={(event) => setAllowChallenge(event.target.checked)} /><span>Allow challenges — other students in the queue can take my next rival slot</span></label></div>
        <button className="action" disabled={!connected || !selectedBankId} onClick={() => { localStorage.setItem('zerosum-name', name); send('createSoloRun', { playerId: clientId, name, avatar, bankId: selectedBankId, ladderLength, feedbackMode, allowChallenge, startingDifficulty, questionSeconds }); }}>Start streak run</button>
      </div>}
      {mode === 'challenge' && <div className="panel entry-form">
        <button type="button" className="back" onClick={() => setMode('choose')}>← Back</button>
        <div className="eyebrow">CHALLENGE QUEUE</div><h2>End someone&rsquo;s streak</h2>
        <p className="muted">Pick the same pack as the streak player. When they finish their current duel, you take the next rival slot.</p>
        <label>Fighter handle<input autoFocus maxLength={24} value={name} onChange={(event) => setName(event.target.value)} placeholder="Streak breaker" /></label>
        <label>Challenge pack<select value={selectedBankId} onChange={(event) => setSelectedBankId(event.target.value)}>{banks.map((bank) => <option key={bank.id} value={bank.id}>{bank.isSample ? 'Included · ' : ''}{bank.name}</option>)}</select></label>
        <div className="open-list in-panel">{openChallenges.length ? openChallenges.map((open) => <article key={open.code}><FighterAvatar seed={open.playerAvatar} /><div><b>{open.playerName} <small>#{open.code}</small></b><span>🎒 {open.bankName} · 🔥 {open.streak} · rival {open.rivalIndex}/{open.ladderLength}</span></div><button type="button" onClick={() => { setSelectedBankId(open.bankId); playSfx('click'); if (!queuePosition) send('joinChallengeQueue', { playerId: clientId, name, avatar, bankId: open.bankId }); }}>Queue for this streak ⚔</button></article>) : <p className="muted">No live streaks are open right now — this list refreshes every few seconds.</p>}</div>
        {queuePosition ? <><p className="queue-status">⚔ You are #{queuePosition} in the queue. Keep this tab open…</p><button className="secondary-action" onClick={() => send('leaveChallengeQueue', { playerId: clientId })}>Leave queue</button></>
        : <button className="action" disabled={!connected || !selectedBankId} onClick={() => { localStorage.setItem('zerosum-name', name); send('joinChallengeQueue', { playerId: clientId, name, avatar, bankId: selectedBankId }); }}>Join challenge queue</button>}
      </div>}
      {mode === 'login' && <form className="panel entry-form" onSubmit={signIn}>
        <button type="button" className="back" onClick={() => setMode('choose')}>← Back</button>
        <div className="eyebrow">HOST ACCESS</div><h2>Sign in to your arena</h2>
        <p className="muted">Only hosts need accounts. Players continue to join anonymously with a game code.</p>
        <label>Email<input autoFocus type="email" autoComplete="username" value={loginEmail} onChange={(event) => setLoginEmail(event.target.value)} placeholder="host@example.com" /></label>
        <label>Password<input type="password" autoComplete="current-password" value={loginPassword} onChange={(event) => setLoginPassword(event.target.value)} /></label>
        <button className="action" disabled={!connected}>Sign in</button>
      </form>}
      {mode === 'host' && <div className="panel entry-form">
        <button type="button" className="back setup-back" onClick={() => setMode('choose')}>← Back to role selection</button>
        <h2>Create your arena</h2>
        <label>Challenge pack<select value={selectedBankId} onChange={(event) => setSelectedBankId(event.target.value)}>{banks.map((bank) => <option key={bank.id} value={bank.id}>{bank.isSample ? 'Included · ' : ''}{bank.name} · {bank.gameMode === 'RPS' ? 'PvP mode' : `${bank.questionCount} questions`}</option>)}</select><small>{customBankCount} of {account?.limits.banks ?? 0} custom packs · included samples do not count · {account?.limits.players ?? 0} players maximum</small></label>
        <button type="button" className="secondary-action" onClick={() => { setBankManagerView('library'); setMode('banks'); }}>Manage challenge packs</button>
        <div className="setup-option"><label className="toggle"><input type="checkbox" checked={flawlessBonus} onChange={(event) => setFlawlessBonus(event.target.checked)} /><span>Flawless victory heals 1 HP</span></label><FlawlessHelp /></div>
        <div className="setup-option"><label className="toggle"><input type="checkbox" checked={hostPlay} onChange={(event) => setHostPlay(event.target.checked)} /><span>Play as host — join as a fighter; rounds auto-run and answer keys stay hidden from you</span></label></div>
        <label>Seconds per question<select value={questionSeconds} onChange={(event) => setQuestionSeconds(Number(event.target.value))}>{[20, 25, 30, 45, 60, 90, 120].map((seconds) => <option key={seconds} value={seconds}>{seconds} seconds</option>)}</select><small>Fixed for the entire tournament · minimum 20 seconds</small></label>
        <fieldset className="tone-setting"><legend>Arena tone</legend><small>How should Zerosum celebrate winners and roast eliminated players?</small><div className="tone-grid">{arenaToneOptions.map((option) => <button type="button" className={arenaTone === option.id ? 'selected' : ''} aria-pressed={arenaTone === option.id} key={option.id} onClick={() => setArenaTone(option.id)}><span>{option.level}</span><b>{option.label}</b></button>)}</div><div className={`tone-preview tone-${selectedArenaTone.id.toLowerCase().replace('_', '-')}`}><header><strong>LEVEL {selectedArenaTone.level} · {selectedArenaTone.label}</strong><span>{selectedArenaTone.description}</span></header><details className="tone-samples"><summary>Preview sample lines</summary><div><p><b>WINNER</b> “{selectedArenaTone.winner}”</p><p><b>ELIMINATED</b> “{selectedArenaTone.loser}”</p></div></details></div></fieldset>
        <div className="setup-actions single"><button type="button" className="action" disabled={!connected} onClick={createTournament}>Create tournament</button></div>
      </div>}
      {mode === 'banks' && <section className="panel bank-manager">
        <button type="button" className="back" onClick={() => bankManagerView === 'library' ? setMode('host') : setBankManagerView('library')}>← {bankManagerView === 'library' ? 'Back to tournament setup' : 'Back to your packs'}</button>

        {bankManagerView === 'library' && <>
          <div className="manager-heading"><div><div className="eyebrow">YOUR QUESTION LIBRARY</div><h2>Choose how you want to build</h2><p>Create questions one at a time, or bring in a ready-made file.</p></div><span>{customBankCount}/{account?.limits.banks ?? 0} custom packs</span></div>
          <div className="creation-choices">
            <button type="button" className="creation-card primary" disabled={!canManagePacks || customBankCount >= (account?.limits.banks ?? 0)} onClick={() => setBankManagerView('create')}><span>＋</span><b>Create in Zerosum</b><small>{canManagePacks ? 'A guided editor for questions and answers' : 'Paid beta account required'}</small></button>
            <button type="button" className="creation-card" disabled={!canManagePacks || customBankCount >= (account?.limits.banks ?? 0)} onClick={() => setBankManagerView('import')}><span>⇧</span><b>Import a file</b><small>{canManagePacks ? 'Upload a JSON or CSV question pack' : 'Paid beta account required'}</small></button>
            {isAdmin && authenticated && <button type="button" className="creation-card ai-card" onClick={() => setBankManagerView('ai')}><span>✦</span><b>AI Pack Forge</b><small>{aiEnabled ? 'Meta ' + aiModel + ' turns a topic, notes, or PDF into a playable pack' : 'Powered by Meta Muse Spark - server key needed to activate'}</small></button>}
          </div>
          {publicBeta && <p className="limit-note">{canManagePacks ? 'Your paid test account can create and import private packs and preview answer keys.' : 'Sign in with a paid test account to create private packs and preview answer keys; you can still use every included pack.'}</p>}
          <div className="library-heading"><h3>Your challenge packs</h3><small>Select a pack to use it in your next tournament.</small></div>
          <div className="bank-summary friendly">{banks.map((bank) => <button type="button" className={selectedBankId === bank.id ? 'selected' : ''} key={bank.id} onClick={() => { setSelectedBankId(bank.id); setMode('host'); }}><span className="pack-icon">{bank.gameMode === 'RPS' ? '✊' : bank.isSample ? '★' : '✦'}</span><span><b>{bank.name}</b><small>{bank.isSample ? 'Included with Zerosum' : 'Your custom pack'} · {bank.gameMode === 'RPS' ? 'Player-vs-player mode' : `${bank.questionCount} questions`}</small></span><em>{selectedBankId === bank.id ? 'Selected' : 'Use pack'}</em></button>)}</div>
          {customBankCount >= (account?.limits.banks ?? 0) && <p className="limit-note">You have used all custom pack slots on this plan. Included samples remain available.</p>}
          {isAdmin && authenticated && <><div className="library-heading"><h3>Admin · pack visibility</h3><small>Hidden packs disappear for students and guests, but stay visible to you.</small></div><div className="bank-summary friendly admin-packs">{[...new Map(banks.map((bank) => [bank.name, bank])).values()].map((bank) => <article className={bank.hidden ? 'admin-pack-card is-hidden' : 'admin-pack-card'} key={bank.name}><span className="pack-icon">{bank.gameMode === 'RPS' ? '✊' : bank.isSample ? '★' : '✦'}</span><span><b>{bank.name}</b><small>{bank.gameMode === 'RPS' ? 'Player-vs-player mode' : bank.questionCount + ' questions'} · {bank.hidden ? 'Hidden from students' : 'Visible to everyone'}</small></span><button type="button" className={bank.hidden ? 'pack-toggle show' : 'pack-toggle'} onClick={async () => { const response = await fetch('/api/admin/packs/visibility', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: bank.name, hidden: !bank.hidden }) }); if (response.ok) { await loadBanks(); playSfx('click'); } else setError('Could not update pack visibility.'); }}>{bank.hidden ? '👁 Show' : 'Hide'}</button></article>)}</div></>}
        </>}

        {canManagePacks && bankManagerView === 'create' && <form className="pack-builder" onSubmit={saveManualBank}>
          <div className="manager-heading"><div><div className="eyebrow">CREATE IN ZEROSUM</div><h2>Build a challenge pack</h2><p>Add at least three questions. Mark one correct answer for each.</p></div><span>{draftQuestions.length}/{account?.limits.questionsPerBank ?? 0} questions</span></div>
          <div className="pack-details"><label>Pack title<input autoFocus maxLength={80} value={bankName} onChange={(event) => setBankName(event.target.value)} placeholder="Example: Science Showdown" /></label><label>Description <small>Optional</small><input maxLength={300} value={bankDescription} onChange={(event) => setBankDescription(event.target.value)} placeholder="What will players practice?" /></label></div>
          <div className="duplicate-setting"><label className="toggle"><input type="checkbox" checked={allowDuplicateQuestions} onChange={(event) => setAllowDuplicateQuestions(event.target.checked)} /><span><b>Allow repeated questions</b><small>Use this when you intentionally want the same question more than once. The Duplicate button turns this on automatically.</small></span></label></div>
          <div className="question-editor-list">{draftQuestions.map((question, questionIndex) => <article className="question-editor" key={question.id}>
            <header><span>QUESTION {questionIndex + 1}</span><div className="question-actions"><button type="button" disabled={draftQuestions.length >= (account?.limits.questionsPerBank ?? 0)} onClick={() => duplicateDraftQuestion(question.id)}>Duplicate</button><button type="button" disabled={draftQuestions.length <= 3} onClick={() => setDraftQuestions((questions) => questions.filter((candidate) => candidate.id !== question.id))}>Remove</button></div></header>
            <label>Question<textarea maxLength={500} value={question.prompt} onChange={(event) => updateDraftQuestion(question.id, { prompt: event.target.value })} placeholder="Type your question here" /></label>
            <div className="answer-editor">{question.options.map((option, optionIndex) => <div className={question.correctIndex === optionIndex ? 'answer-option correct' : 'answer-option'} key={`${question.id}-${optionIndex}`}>
              <label className="correct-choice"><input type="radio" name={`correct-${question.id}`} checked={question.correctIndex === optionIndex} onChange={() => updateDraftQuestion(question.id, { correctIndex: optionIndex })} /><span>{question.correctIndex === optionIndex ? 'Correct' : String.fromCharCode(65 + optionIndex)}</span></label>
              <input aria-label={`Question ${questionIndex + 1}, answer ${optionIndex + 1}`} maxLength={200} value={option} onChange={(event) => updateDraftOption(question.id, optionIndex, event.target.value)} placeholder={`Answer ${optionIndex + 1}`} />
              <button type="button" aria-label={`Remove answer ${optionIndex + 1}`} disabled={question.options.length <= 2} onClick={() => removeDraftOption(question.id, optionIndex)}>×</button>
            </div>)}</div>
            <button type="button" className="add-answer" disabled={question.options.length >= 6} onClick={() => updateDraftQuestion(question.id, { options: [...question.options, ''] })}>＋ Add another answer</button>
            <div className="question-notes"><label>Answer explanation <small>Optional</small><textarea maxLength={1000} value={question.explanation} onChange={(event) => updateDraftQuestion(question.id, { explanation: event.target.value })} placeholder="Explain why the answer is correct" /></label><label>Difficulty<select value={question.difficulty} onChange={(event) => updateDraftQuestion(question.id, { difficulty: event.target.value as DraftQuestion['difficulty'] })}><option value="basic">Quick answer</option><option value="scenario">Scenario</option></select></label></div>
          </article>)}</div>
          <button type="button" className="add-question" disabled={draftQuestions.length >= (account?.limits.questionsPerBank ?? 0)} onClick={() => setDraftQuestions((questions) => [...questions, createDraftQuestion()])}>＋ Add question</button>
          <div className="builder-actions"><button type="button" className="secondary-action" onClick={() => setBankManagerView('library')}>Cancel</button><button className="action" disabled={savingBank}>{savingBank ? 'Saving…' : 'Save challenge pack'}</button></div>
        </form>}

        {bankManagerView === 'ai' && isAdmin && authenticated && <form className="pack-import ai-forge" onSubmit={generateAiPack}>
          <div className="manager-heading"><div><div className="eyebrow">AI PACK FORGE · POWERED BY META MUSE SPARK</div><h2>Turn a lesson into a battle</h2><p>Teachers: type a topic or paste lesson notes. Meta AI writes curriculum-friendly questions with teaching explanations, checked by Zerosum before they can be played.</p></div><span>{aiEnabled ? 'AI online' : 'AI key needed'}</span></div>
          {!aiEnabled && <p className="limit-note">The forge is built and ready - it activates the moment a Meta Model API key (MODEL_API_KEY from dev.meta.ai) is added on the server. Ready-made packs below still work right now.</p>}
          <label>Topic <small>Optional if you upload a document</small><input autoFocus maxLength={120} value={aiTopic} onChange={(event) => setAiTopic(event.target.value)} placeholder="Example: Photosynthesis for Grade 6" /></label>
          <label>Who is this for?<select value={aiAudience} onChange={(event) => setAiAudience(event.target.value)}><option>Classroom learners</option><option>Exam reviewers</option><option>Self-study learners</option><option>Everyone / trivia night</option><option>Workplace training</option></select></label>
          <label>Questions<select value={aiCount} onChange={(event) => setAiCount(Number(event.target.value))}><option value={8}>8 questions</option><option value={12}>12 questions</option><option value={16}>16 questions</option><option value={20}>20 questions</option></select></label>
          <label>Lesson notes <small>Optional - paste your own material and questions will be based only on it</small><textarea maxLength={8000} rows={6} value={aiSource} onChange={(event) => setAiSource(event.target.value)} placeholder="Paste lesson notes, a reviewer, or a chapter summary..." /></label>
          <label className="file-drop"><span>Upload lesson document (PDF, TXT, MD, CSV, JSON · up to 4 MB)</span><small>{aiFile ? aiFile.name : 'Text is extracted on the server for free; only a short excerpt is sent to Meta AI to save tokens'}</small><input type="file" accept=".pdf,.txt,.md,.markdown,.csv,.json" onChange={(event) => { const file = event.target.files?.[0]; if (!file) return setAiFile(undefined); if (file.size > 4 * 1024 * 1024) return setError('Upload a document up to 4 MB.'); const reader = new FileReader(); reader.onload = () => setAiFile({ name: file.name, contentBase64: String(reader.result).split(',')[1] ?? '' }); reader.readAsDataURL(file); }} /></label>
          {aiDocNote && <p className="limit-note">{aiDocNote}</p>}
          <div className="builder-actions"><button type="button" className="secondary-action" onClick={() => setBankManagerView('library')}>Cancel</button><button className="action" disabled={aiBusy || !aiEnabled}>{aiBusy ? 'Forging with Meta AI...' : 'Forge my pack ✦'}</button></div>
        </form>}

        {canManagePacks && bankManagerView === 'import' && <form className="pack-import" onSubmit={importBank}>
          <div className="manager-heading"><div><div className="eyebrow">IMPORT A FILE</div><h2>Upload a ready-made pack</h2><p>Perfect when you already have many questions. Zerosum checks the file before saving it.</p></div><span>JSON or CSV</span></div>
          <div className="import-steps"><span><b>1</b>Download a template</span><span><b>2</b>Add your questions</span><span><b>3</b>Upload and check</span></div>
          <div className="template-actions"><button type="button" onClick={() => downloadTemplate('json')}>Download JSON template</button><button type="button" onClick={() => downloadTemplate('csv')}>Download CSV template</button></div>
          <label>Pack title<input autoFocus maxLength={80} value={bankName} onChange={(event) => setBankName(event.target.value)} placeholder="Example: AWS Fundamentals" /></label>
          <label>Description <small>Optional</small><input maxLength={300} value={bankDescription} onChange={(event) => setBankDescription(event.target.value)} placeholder="What will players practice?" /></label>
          <label className="file-drop"><span>Choose your JSON or CSV file</span><small>{bankFile ? bankFile.name : 'Maximum file size: 1 MB'}</small><input type="file" accept=".json,.csv,application/json,text/csv" onChange={(event) => setBankFile(event.target.files?.[0])} /></label>
          <p className="limit-note">Your {account?.plan.toLowerCase()} plan allows {account?.limits.questionsPerBank} questions per custom pack and {account?.limits.totalQuestions} custom questions total.</p>
          <div className="builder-actions"><button type="button" className="secondary-action" onClick={() => setBankManagerView('library')}>Cancel</button><button className="action" disabled={savingBank}>{savingBank ? 'Checking…' : 'Check and import'}</button></div>
        </form>}
      </section>}
      {error && <div className="toast error">{error}</div>}
      <footer><span className={connected ? 'online' : 'offline'}>●</span> {connected ? 'Battle network online' : 'Connecting…'}</footer>
    </main>);
  }

  if (isHost && !snapshot) return withMusic(<main className="shell centered"><div className="spinner"/><div className="eyebrow">RESTORING HOST SESSION</div><h1>Reconnecting to your arena…</h1><p className="muted">If this tournament has already ended or the session expired, return to the main menu.</p><button type="button" className="secondary-action replay-action" onClick={returnHome}>Return home</button>{error && <div className="toast error">{error}</div>}</main>);

  if (isHost && !snapshot?.me) {
    const tournament = snapshot?.tournament;
    return withMusic(<main className="shell dashboard">
      <header><div className="brand"><span className="cloud-mark">Ø</span>ZEROSUM</div><div className="dashboard-header-actions"><div className="round-pill">{tournament?.phase === 'LOBBY' ? 'LOBBY' : tournament?.phase === 'CANCELLED' ? 'CANCELLED' : tournament?.phase === 'ROUND_BREAK' ? `ROUND ${tournament.round} COMPLETE` : `ROUND ${tournament?.round ?? 0}`}</div><AccountBadge account={account} publicBeta={publicBeta} authenticated={authenticated} onSignOut={authenticated ? signOut : undefined} compact /></div></header>
      <section className="host-hero">
        <div><div className="eyebrow">INSTRUCTOR CONTROL</div><h1>{tournament?.phase === 'COMPLETE' ? 'Tournament complete' : tournament?.phase === 'CANCELLED' ? 'Tournament cancelled' : tournament?.phase === 'LOBBY' ? 'Your arena is ready' : tournament?.phase === 'ROUND_BREAK' ? `Ready for Round ${(tournament.round ?? 0) + 1}` : 'Clash in progress'}</h1></div>
        {['COMPLETE', 'CANCELLED'].includes(tournament?.phase ?? '') ? <div className="retired-code"><small>GAME CODE</small><strong>RETIRED</strong><span>A new tournament creates a new code.</span></div> : <div className="join-code"><small>JOIN CODE</small><strong>{code}</strong><button type="button" onClick={copyJoinLink}>{copyStatus}</button></div>}
      </section>
      {tournament?.phase === 'COMPLETE' && <>
        <section className="champion-banner">🏆 {playerName(snapshot?.players ?? [], tournament.championId ?? '')} is the Zerosum champion!</section>
        <div className="reset-actions"><button className="share-action" onClick={downloadShareableLeaderboard}>🏆 Download leaderboard</button><button className="action" onClick={createTournament}>Host another tournament</button><button className="secondary-action" onClick={returnHome}>Return home</button></div>
      </>}
      {tournament?.phase === 'CANCELLED' && <><section className="cancelled-banner">Tournament ended before play. Its join code can no longer be used.</section><div className="reset-actions"><button className="action" onClick={createTournament}>Host another tournament</button><button className="secondary-action" onClick={returnHome}>Return home</button></div></>}
      <div className="stats"><div><strong>{tournament?.playerCount ?? 0}</strong><span>Players</span></div><div><strong>{tournament?.activeCount ?? 0}</strong><span>Still standing</span></div><div><strong>{snapshot?.matches.filter((match) => match.phase === 'COMPLETE').length ?? 0}/{snapshot?.matches.length ?? 0}</strong><span>Matches finished</span></div></div>
      {tournament?.phase === 'LOBBY' && <div className="tournament-settings"><span>⏱ {tournament.questionSeconds}s per question</span><span>⌛ Lobby closes in {formatCountdown(lobbyRemaining)}</span><span>🎙 {arenaToneLabel(tournament.arenaTone)} tone</span><span>{tournament.flawlessBonus ? '♥ Flawless healing on' : '♡ Flawless healing off'}</span><FlawlessHelp /></div>}
      {['LOBBY', 'ROUND_BREAK'].includes(tournament?.phase ?? '') && <button className="action start" disabled={(tournament?.activeCount ?? 0) < 2} onClick={() => send('startTournament', { code, hostToken })}>{tournament?.phase === 'LOBBY' ? 'Start tournament' : `Start Round ${(tournament?.round ?? 0) + 1}`}</button>}
      {['LOBBY', 'IN_ROUND', 'ROUND_BREAK'].includes(tournament?.phase ?? '') && <div className="cancel-controls">{confirmCancel ? <><span>End this tournament and retire its code?</span><button className="danger-action" onClick={() => send('cancelTournament', { code, hostToken })}>Yes, terminate tournament</button><button className="secondary-action" onClick={() => setConfirmCancel(false)}>Keep lobby</button></> : <button className="danger-link" onClick={() => setConfirmCancel(true)}>Terminate this tournament</button>}</div>}
      <section><div className="section-title"><h2>{tournament?.phase === 'LOBBY' ? 'Players in lobby' : 'Live matches'}</h2><span>Updates automatically</span></div>
        {tournament?.phase === 'LOBBY' ? <div className="roster">{snapshot?.players.map((player, index) => <div key={player.id}><span>{index + 1}</span><PlayerAvatar player={player} /><span className="roster-name">{player.name}</span><strong>{hpDisplay(player.hp)}</strong></div>)}</div> : <div className="match-grid">{snapshot?.matches.map((match) => <MatchCard key={match.id} match={match} players={snapshot.players} />)}</div>}
      </section>
      <section className="host-insights"><div><div className="eyebrow">INSTRUCTOR REVIEW</div><h2>Progress & learning tools</h2><p>{canViewAnswers ? 'Your paid host account can review answers and explanations throughout the tournament.' : 'Answer previews require a signed-in paid host during public beta.'}</p></div><div className="insight-actions"><button className="insight-button" disabled={!snapshot?.matchHistory?.length} onClick={() => setProgressionOpen(true)}><span>⇢</span><b>View progression</b><small>{snapshot?.matchHistory?.length ?? 0} matches tracked</small></button>{canViewAnswers && <button className="insight-button" disabled={!snapshot?.reviewQuestions?.length} onClick={() => setReviewOpen(true)}><span>✓</span><b>Review used questions</b><small>{snapshot?.reviewQuestions?.length ?? 0} unique questions</small></button>}</div></section>
      {tournament?.phase === 'LOBBY' && snapshot?.questionBank && <section className="bank-section"><details><summary><span>{tournament.bankName} · {tournament.gameMode === 'RPS' ? 'move rules' : 'answer key'}</span><small>{snapshot.questionBankInfo?.eligibleQuestions ?? snapshot.questionBank.length} playable challenges · host only</small></summary><div className="bank-tools"><input value={questionSearch} onChange={(event) => setQuestionSearch(event.target.value)} placeholder="Search challenges or answers…"/><span>{filteredQuestions.length} shown</span></div><div className="bank-list">{filteredQuestions.map((question) => <article key={question.id}><header><b>{question.id.slice(0, 8)}</b><span>{tournament.gameMode === 'RPS' ? 'Player choice' : questionLabel(question)}</span><em>{question.difficulty}</em></header><p>{question.text}</p><ol type="A">{question.options.map((option, index) => <li className={tournament.gameMode !== 'RPS' && index === question.correctIndex ? 'correct' : ''} key={option}>{option}{tournament.gameMode !== 'RPS' && index === question.correctIndex && <strong> ✓ Correct</strong>}</li>)}</ol><small>{question.explanation}</small></article>)}</div></details></section>}
      <section className="event-section"><div className="section-title"><div><h2>Event log {canViewAnswers ? '& class review' : ''}</h2><span>{canViewAnswers ? 'Paid hosts can review the questions and answers used during the tournament' : 'Gameplay events are recorded without revealing challenge content'}</span></div><button className="log-download" onClick={downloadReport}>Download HTML report</button></div>
        <div className="event-log">{snapshot?.events?.length ? snapshot.events.map((event) => <div key={event.id}><time>{new Date(event.at).toLocaleTimeString()}</time><span className="event-kind">{event.kind.replaceAll('_', ' ')}</span><span>{typeof event.details?.questionId === 'string' && <b className="event-question">{event.details.questionId}</b>}{event.message}</span></div>) : <p className="muted">Tournament events will appear here.</p>}</div>
      </section>
      {progressionOpen && <div className="dashboard-modal" role="dialog" aria-modal="true" aria-label="Tournament progression" onClick={() => setProgressionOpen(false)}><section className="dashboard-modal-panel" onClick={(event) => event.stopPropagation()}><button className="modal-close" aria-label="Close tournament progression" onClick={() => setProgressionOpen(false)}>×</button><TournamentProgression matches={snapshot?.matchHistory ?? []} players={snapshot?.players ?? []} championId={tournament?.championId} /></section></div>}
      {reviewOpen && <div className="dashboard-modal" role="dialog" aria-modal="true" aria-label="Challenges used in this tournament" onClick={() => setReviewOpen(false)}><section className="dashboard-modal-panel review-panel" onClick={(event) => event.stopPropagation()}><button className="modal-close" aria-label="Close challenge review" onClick={() => setReviewOpen(false)}>×</button><div className="modal-heading"><div className="eyebrow">CLASS REVIEW</div><h2>{tournament?.gameMode === 'RPS' ? 'Move rounds used in this tournament' : 'Questions used in this tournament'}</h2><p>{tournament?.gameMode === 'RPS' ? 'Player choices and results are recorded in the event log.' : 'Correct answers and explanations are shown for instructor-led discussion.'}</p></div><QuestionReview questions={snapshot?.reviewQuestions ?? []} matches={snapshot?.matchHistory ?? []} gameMode={tournament?.gameMode} /></section></div>}
      {error && <div className="toast error">{error}</div>}
    </main>);
  }

  if (!snapshot) return withMusic(<main className="shell centered"><div className="spinner"/><p>Entering the arena…</p>{error && <div className="toast error">{error}</div>}</main>);

  if (snapshot.tournament.phase === 'CANCELLED') return withMusic(<main className="shell centered"><div className="trophy dim">⌛</div><div className="eyebrow">LOBBY CLOSED</div><h1>Tournament cancelled</h1><p>This tournament was ended by the instructor or expired after 20 minutes.</p><button className="action replay-action" onClick={returnHome}>Return home</button></main>);

  if (snapshot.tournament.phase === 'LOBBY') return withMusic(<main className="shell centered">
    <div className="brand"><span className="cloud-mark">Ø</span>ZEROSUM</div>
    <div className="eyebrow">YOU’RE IN</div><h1>Waiting for the clash</h1><div className="big-code">{snapshot.tournament.code}</div>
    <p className="muted">{snapshot.tournament.playerCount} player{snapshot.tournament.playerCount === 1 ? '' : 's'} joined · The instructor will start the tournament</p><p className="lobby-expiry">Lobby closes in {formatCountdown(lobbyRemaining)} if it has not started</p>
    <div className="player-chip"><PlayerAvatar player={me} /><span>{me?.name}</span><strong>{hpDisplay(me?.hp ?? 3)}</strong></div>
    {isHost && hostToken && <button className="action start" disabled={(snapshot.tournament.activeCount ?? 0) < 2} onClick={() => send('startTournament', { code: snapshot.tournament.code, hostToken })}>Start tournament (auto-run on)</button>}
  </main>);

  if (snapshot.tournament.mode === 'SOLO' && snapshot.tournament.phase === 'COMPLETE') return withMusic(<main className="shell centered solo-result">
    <div className="brand"><span className="cloud-mark">Ø</span>ZEROSUM</div>
    <div className="eyebrow">SOLO ARCADE · {snapshot.tournament.bankName}</div>
    <div className="trophy">{snapshot.tournament.championId === me?.id ? '🏆' : '💥'}</div>
    <h1>{snapshot.tournament.championId === me?.id ? (snapshot.me?.isBot || !me ? 'Run complete' : snapshot.tournament.streak >= snapshot.tournament.ladderLength ? 'Ladder cleared!' : 'You ended the streak!') : 'Your streak was ended'}</h1>
    <p className="solo-streak-big">🔥 {snapshot.tournament.streak} <small>win streak</small></p>
    <p className="muted">Leaderboard entry: <b>{me?.name} #{snapshot.tournament.code}</b> · {snapshot.tournament.bankName}</p>
    {soloLeaderboard.length ? <ol className="leaderboard-list result-board">{soloLeaderboard.slice(0, 5).map((entry, index) => <li key={entry.code} className={entry.code === snapshot.tournament.code ? 'mine' : ''}><b>#{index + 1}</b><FighterAvatar seed={entry.avatar} /><span className="board-name">{entry.name} <small>#{entry.code}</small></span><strong>🔥 {entry.streak}</strong></li>)}</ol> : null}
    {snapshot.reviewQuestions?.length ? <section className="solo-review"><h2>Run review</h2><QuestionReview questions={snapshot.reviewQuestions} matches={snapshot.matchHistory ?? []} gameMode={snapshot.tournament.gameMode} /></section> : null}
    <div className="reset-actions"><button className="action" onClick={() => { setSnapshot(undefined); setMode('solo'); }}>Run it back</button><button className="secondary-action" onClick={returnHome}>Return home</button></div>
  </main>);

  if (me?.status === 'CHAMPION') return <ChampionThrone snapshot={snapshot} me={me} onDownloadLeaderboard={downloadShareableLeaderboard} onReturnHome={returnHome}/>;
  if (me?.status === 'ELIMINATED' || me?.status === 'WAITING') return withMusic(<SpectatorArena snapshot={snapshot} me={me} bracket={spectatorBracket} bracketOpen={spectatorBracketOpen} onViewBracket={viewPlayerBracket} onCloseBracket={() => setSpectatorBracketOpen(false)} onDownloadLeaderboard={downloadShareableLeaderboard} onReturnHome={returnHome}/>);
  if (!snapshot.question) return withMusic(<main className="shell centered"><div className="spinner"/><div className="eyebrow">SYNCING ARENA</div><h1>Preparing the next challenge…</h1></main>);

  return withMusic(<main className="shell battle">
    {damageEffect && <DamageOverlay key={damageEffect.key} amount={damageEffect.amount} player={me} />}
    <header><div className="brand"><span className="cloud-mark">Ø</span>ZEROSUM <span className="live-dot">LIVE</span></div><div className="round-pill">ROUND {snapshot.tournament.round} · CHALLENGE {snapshot.question.number}</div></header>
    {snapshot.tournament.mode === 'SOLO' && <div className="solo-hud"><span>🔥 STREAK {snapshot.tournament.streak}</span><span>RIVAL {snapshot.tournament.rivalIndex}/{snapshot.tournament.ladderLength}</span><span>{snapshot.tournament.feedbackMode === 'LEARN' ? '📖 LEARN MODE' : '📝 EXAM MODE'}</span>{snapshot.tournament.allowChallenge && <span>⚔ OPEN TO CHALLENGERS</span>}</div>}
    <BattleStage me={me} opponents={opponents.map((id) => snapshot.players.find((player) => player.id === id)).filter((player): player is PublicPlayer => Boolean(player))} combat={snapshot.combat} charging={Boolean(answered)} gameMode={snapshot.tournament.gameMode} />
    {snapshot.tournament.mode === 'SOLO' && <div className="forfeit-row in-battle">{confirmForfeit ? <><span>Forfeit this run? Your 🔥 {snapshot.tournament.streak} streak is recorded on the leaderboard and the run ends, so you can join another class or game right away.</span><button type="button" className="danger-action" onClick={() => { send('forfeitSoloRun', { code: snapshot.tournament.code, playerId: clientId }); setConfirmForfeit(false); playSfx('lose'); }}>Yes, forfeit run</button><button type="button" className="secondary-action" onClick={() => setConfirmForfeit(false)}>Keep fighting</button></> : <button type="button" className="forfeit-button" onClick={() => { setConfirmForfeit(true); playSfx('click'); }}>🏳 Forfeit run &amp; exit</button>}</div>}
    <div className={`timer ${remaining <= 5 ? 'danger' : ''}`}><span style={{ '--progress': `${Math.max(0, Math.min(100, remaining / snapshot.tournament.questionSeconds * 100))}%` } as React.CSSProperties}></span><strong>{remaining}</strong></div>
    {snapshot.notice && <div className="battle-notice">⚡ {snapshot.notice}</div>}
    <section className={`question-card ${snapshot.tournament.gameMode === 'RPS' ? 'rps-card' : ''}`}><div className="question-meta"><div className="eyebrow">{snapshot.tournament.gameMode === 'RPS' ? 'PICK YOUR MOVE' : 'SELECT THE BEST ANSWER'}</div>{snapshot.question.domain && <span>DOMAIN {snapshot.question.domain}</span>}</div><h1>{snapshot.question.text}</h1><div className="answers">{snapshot.question.options.map((option, index) => <button aria-label={`${snapshot.tournament.gameMode === 'RPS' ? 'Move' : 'Answer'} ${String.fromCharCode(65 + index)}: ${option}`} key={option} disabled={Boolean(answered) || remaining === 0} onClick={() => answer(index)}><span>{String.fromCharCode(65 + index)}</span>{option}<kbd>{String.fromCharCode(65 + index)}</kbd></button>)}</div></section>
    {snapshot.combat?.explanation && snapshot.tournament.feedbackMode === 'LEARN' && <div className="learn-card"><strong>Why: </strong>{snapshot.combat.explanation}</div>}
    {answered && <div className="locked">{snapshot.tournament.gameMode === 'RPS' ? 'Move locked · waiting for your opponent' : 'Answer locked · waiting for your opponent'}</div>}
  </main>);
}
