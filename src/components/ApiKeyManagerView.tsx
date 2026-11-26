import { useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  KeyRound,
  Loader2,
  Plus,
  Power,
  ShieldCheck,
  Trash2,
} from 'lucide-react';
import type { ApiKeyRecord, ProviderPoolStatus } from '../types';
import { api } from '../api';

interface ApiKeyManagerProps {
  provider: 'gemini' | 'groq';
  keys: ApiKeyRecord[];
  poolStatus: ProviderPoolStatus | null;
  onRefresh: () => Promise<void>;
}

export function ApiKeyManagerView({
  provider,
  keys,
  poolStatus,
  onRefresh,
}: ApiKeyManagerProps) {
  const [label, setLabel] = useState('');
  const [rawKey, setRawKey] = useState('');
  const [adding, setAdding] = useState(false);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  const filtered = keys.filter((k) => k.provider === provider);
  const statusInfo = provider === 'gemini' ? poolStatus?.gemini : poolStatus?.groq;
  const providerTitle = provider === 'gemini' ? 'Gemini AI' : 'Groq Whisper';

  const handleAdd = async () => {
    if (!rawKey.trim()) return;
    setAdding(true);
    setFeedback(null);
    try {
      await api.addKey(provider, label.trim() || `${providerTitle} Key #${filtered.length + 1}`, rawKey.trim());
      setLabel('');
      setRawKey('');
      setFeedback(`${providerTitle} key encrypted and added to the automatic rotation pool.`);
      await onRefresh();
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : String(err));
    } finally {
      setAdding(false);
    }
  };

  const handleTest = async (id: string) => {
    setTestingId(id);
    setFeedback(null);
    try {
      const res = await api.testKey(id);
      setFeedback(res.message);
      await onRefresh();
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : String(err));
    } finally {
      setTestingId(null);
    }
  };

  const handleToggle = async (k: ApiKeyRecord) => {
    await api.updateKey(k.id, { isEnabled: !k.isEnabled });
    await onRefresh();
  };

  const handleDelete = async (id: string) => {
    await api.deleteKey(id);
    await onRefresh();
  };

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="bg-[#121826] border border-white/8 rounded-xl p-6 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1 max-w-2xl">
            <h2 className="text-base font-display font-semibold text-slate-100">
              {providerTitle} Rotation Pool Manager
            </h2>
            <p className="text-xs text-slate-400 leading-relaxed">
              {provider === 'gemini'
                ? 'Your server environment Gemini slot handles translation, speaker detection, and Khmer voice synthesis out of the box. You can also add additional encrypted rotation keys for high-volume batch processing; keys rotate automatically on rate limits while respecting provider quotas.'
                : 'Add one or more Groq API keys for fast Whisper speech recognition (whisper-large-v3-turbo). Requests rotate automatically across active keys on rate limits or errors. If no Groq key is added, speech recognition automatically uses Gemini Audio Transcription.'}
            </p>
          </div>
          <div className="text-right font-mono text-xs tabular-nums shrink-0">
            <div className="text-slate-200">
              {statusInfo?.hasAnyReady ? 'Pool Operational' : 'No Key Active'}
            </div>
            <div className="text-slate-500 mt-0.5">
              Env: {statusInfo?.envConfigured ? 'Connected' : 'Unset'} · Pool: {statusInfo?.activePoolKeys ?? 0}/{statusInfo?.totalPoolKeys ?? 0}
            </div>
          </div>
        </div>

        <div className="border-t border-white/8 pt-4 flex items-center justify-between text-xs">
          <div className="flex items-center gap-2 text-slate-300">
            <ShieldCheck className="w-4 h-4 text-amber-400" />
            <span>
              Server Environment Slot ({provider === 'gemini' ? 'GEMINI_API_KEY' : 'GROQ_API_KEY'})
            </span>
          </div>
          <span className={statusInfo?.envConfigured ? 'text-emerald-400 font-medium' : 'text-slate-500'}>
            {statusInfo?.envConfigured
              ? `Active · ${statusInfo.envUsageCount} requests`
              : 'Not configured in server environment'}
          </span>
        </div>
      </div>

      <div className="bg-[#121826] border border-white/8 rounded-xl p-6 space-y-4">
        <h3 className="text-sm font-display font-semibold text-slate-100">
          Add {providerTitle} Rotation Key
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <input
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Key label (e.g. Studio Key 1)"
            className="bg-[#0B0F17] border border-white/10 rounded-lg px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-amber-500"
          />
          <input
            type="password"
            value={rawKey}
            onChange={(e) => setRawKey(e.target.value)}
            placeholder={provider === 'gemini' ? 'Paste rotation key...' : 'Paste gsk_... Groq API key'}
            className="bg-[#0B0F17] border border-white/10 rounded-lg px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-amber-500"
          />
          <button
            type="button"
            disabled={adding || !rawKey.trim()}
            onClick={handleAdd}
            className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold bg-amber-500 text-[#0B0F17] hover:bg-amber-400 disabled:opacity-45 transition-colors whitespace-nowrap"
          >
            {adding ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            <span>Add Encrypted Key</span>
          </button>
        </div>

        <div className="text-xs text-slate-500">
          Keys are encrypted locally with AES-256-GCM on the server, masked in the UI, and never written into logs or exported MP4 videos.
        </div>

        {feedback && (
          <div className="text-xs text-amber-300 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2">
            {feedback}
          </div>
        )}
      </div>

      <div className="bg-[#121826] border border-white/8 rounded-xl overflow-hidden">
        <div className="px-5 py-3 border-b border-white/8 text-xs font-medium text-slate-400">
          Stored {providerTitle} Rotation Keys ({filtered.length})
        </div>

        {filtered.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-400">
            No extra {providerTitle} rotation keys added yet.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-[#0E131F] text-xs text-slate-400 border-b border-white/8">
                <tr>
                  <th className="py-2.5 px-4 font-medium">Label</th>
                  <th className="py-2.5 px-4 font-medium">Masked Key</th>
                  <th className="py-2.5 px-4 font-medium">Status</th>
                  <th className="py-2.5 px-4 font-medium text-right">Usage</th>
                  <th className="py-2.5 px-4 font-medium text-right">Errors</th>
                  <th className="py-2.5 px-4 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/6">
                {filtered.map((k) => (
                  <tr key={k.id} className="hover:bg-white/[0.02]">
                    <td className="py-3 px-4">
                      <div className="font-medium text-slate-100 text-xs">{k.label}</div>
                      {k.lastError && (
                        <div className="text-[11px] text-red-400 truncate max-w-[240px]" title={k.lastError}>
                          {k.lastError}
                        </div>
                      )}
                    </td>
                    <td className="py-3 px-4 font-mono text-xs text-slate-400">{k.keyHint}</td>
                    <td className="py-3 px-4 text-xs">
                      {k.status === 'active' && (
                        <span className="inline-flex items-center gap-1.5 text-emerald-400">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          Active
                        </span>
                      )}
                      {k.status === 'rate_limited' && (
                        <span className="inline-flex items-center gap-1.5 text-amber-400">
                          <AlertTriangle className="w-3.5 h-3.5" />
                          Cooldown
                        </span>
                      )}
                      {k.status === 'invalid' && (
                        <span className="inline-flex items-center gap-1.5 text-red-400">
                          <AlertTriangle className="w-3.5 h-3.5" />
                          Invalid Key
                        </span>
                      )}
                      {k.status === 'disabled' && (
                        <span className="inline-flex items-center gap-1.5 text-slate-500">
                          <KeyRound className="w-3.5 h-3.5" />
                          Disabled
                        </span>
                      )}
                    </td>
                    <td className="py-3 px-4 text-right font-mono text-xs text-slate-300 tabular-nums">
                      {k.usageCount}
                    </td>
                    <td className="py-3 px-4 text-right font-mono text-xs text-slate-400 tabular-nums">
                      {k.errorCount}
                    </td>
                    <td className="py-3 px-4 text-right">
                      <div className="inline-flex items-center gap-1.5">
                        <button
                          type="button"
                          disabled={testingId === k.id}
                          onClick={() => void handleTest(k.id)}
                          className="px-2.5 py-1 rounded text-xs font-medium bg-slate-800 text-slate-200 hover:bg-slate-700 disabled:opacity-50"
                        >
                          {testingId === k.id ? 'Testing...' : 'Verify'}
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleToggle(k)}
                          title={k.isEnabled ? 'Disable Key' : 'Enable Key'}
                          className="p-1.5 rounded text-slate-300 hover:bg-slate-800"
                        >
                          <Power className={`w-3.5 h-3.5 ${k.isEnabled ? 'text-emerald-400' : 'text-slate-500'}`} />
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleDelete(k.id)}
                          title="Delete Key"
                          className="p-1.5 rounded text-slate-400 hover:text-red-400 hover:bg-red-500/10"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
