import {
  AudioLines,
  Download,
  FileAudio,
  Film,
  FolderClock,
  HeartHandshake,
  Home,
  KeyRound,
  Languages,
  Mic2,
  PlaySquare,
  Settings,
  Sliders,
  Upload,
  Users,
} from 'lucide-react';
import type { ComponentType } from 'react';
import type { NavSectionId } from '../types';

export interface NavItem {
  id: NavSectionId;
  label: string;
  group: 'Workflow' | 'Voices & Acting' | 'API Pool' | 'Studio & Output';
  icon: ComponentType<{ className?: string }>;
}

export const NAV_ITEMS: NavItem[] = [
  { id: 'home', label: 'Home Dashboard', group: 'Workflow', icon: Home },
  { id: 'import', label: 'Import Video', group: 'Workflow', icon: Upload },
  { id: 'asr', label: 'Automatic Speech Recognition', group: 'Workflow', icon: FileAudio },
  { id: 'translation', label: 'AI Translation', group: 'Workflow', icon: Languages },
  { id: 'speakers', label: 'Speaker Detection', group: 'Workflow', icon: Users },
  { id: 'voices', label: 'Voice Management', group: 'Voices & Acting', icon: Mic2 },
  { id: 'cloning', label: 'Voice Cloning', group: 'Voices & Acting', icon: AudioLines },
  { id: 'emotions', label: 'Emotion Settings', group: 'Voices & Acting', icon: HeartHandshake },
  { id: 'gemini-keys', label: 'Gemini API Manager', group: 'API Pool', icon: KeyRound },
  { id: 'groq-keys', label: 'Groq API Manager', group: 'API Pool', icon: KeyRound },
  { id: 'audio-sync', label: 'Audio Synchronization', group: 'Studio & Output', icon: Sliders },
  { id: 'preview', label: 'Video Preview', group: 'Studio & Output', icon: PlaySquare },
  { id: 'export', label: 'Export MP4', group: 'Studio & Output', icon: Download },
  { id: 'history', label: 'Project History', group: 'Studio & Output', icon: FolderClock },
  { id: 'settings', label: 'Application Settings', group: 'Studio & Output', icon: Settings },
];

interface SidebarProps {
  activeSection: NavSectionId;
  onSelect: (id: NavSectionId) => void;
}

const GROUPS: NavItem['group'][] = ['Workflow', 'Voices & Acting', 'API Pool', 'Studio & Output'];

export function Sidebar({ activeSection, onSelect }: SidebarProps) {
  return (
    <aside className="w-[256px] shrink-0 bg-[#0E131F] border-r border-white/8 flex flex-col h-screen sticky top-0 select-none">
      <div className="px-5 py-4 border-b border-white/8 flex items-center gap-3">
        <div className="w-8 h-8 rounded-lg bg-amber-500 flex items-center justify-center text-[#0B0F17] shrink-0">
          <Film className="w-4 h-4" />
        </div>
        <div className="min-w-0">
          <div className="font-display font-semibold text-sm text-slate-100 tracking-tight whitespace-nowrap truncate">
            AI Khmer Dubber Pro
          </div>
          <div className="text-[11px] text-slate-400 whitespace-nowrap truncate">
            Windows &amp; Studio Edition
          </div>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-3 space-y-4">
        {GROUPS.map((group) => {
          const items = NAV_ITEMS.filter((i) => i.group === group);
          return (
            <div key={group}>
              <div className="px-2.5 pb-1.5 text-[11px] font-medium text-slate-500">
                {group}
              </div>
              <div className="space-y-0.5">
                {items.map((item) => {
                  const Icon = item.icon;
                  const active = activeSection === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => onSelect(item.id)}
                      className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-[13px] transition-colors text-left ${
                        active
                          ? 'bg-slate-800/90 text-amber-400 font-medium'
                          : 'text-slate-300 hover:bg-slate-800/45 hover:text-slate-100'
                      }`}
                    >
                      <Icon className={`w-4 h-4 shrink-0 ${active ? 'text-amber-400' : 'text-slate-400'}`} />
                      <span className="whitespace-nowrap truncate">{item.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </nav>
    </aside>
  );
}
