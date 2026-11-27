import React, { useState } from 'react';
import { useNexora } from '../../context/NexoraContext';
import {
  X,
  Gamepad2,
  GraduationCap,
  Users,
  Palette,
  Sparkles,
  Upload,
  ArrowRight,
  ChevronLeft,
} from 'lucide-react';
import { validateServerName } from '../../utils/rules';

export const CreateServerModal: React.FC = () => {
  const { activeModal, closeModal, createServer } = useNexora();

  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [selectedTemplate, setSelectedTemplate] = useState('General');
  const [serverAudience, setServerAudience] = useState<'friends' | 'club'>('club');
  const [serverName, setServerName] = useState('');
  const [serverIcon, setServerIcon] = useState('');
  const [validationError, setValidationError] = useState<string | null>(null);

  if (activeModal !== 'create-server') return null;

  const templates = [
    {
      id: 'General',
      name: 'Create My Own',
      desc: 'Start from scratch with default text and voice channels.',
      icon: <Sparkles className="w-5 h-5 text-[#7667F7]" />,
      defaultIcon: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=120&auto=format&fit=crop&q=80',
    },
    {
      id: 'Gaming',
      name: 'Gaming Community',
      desc: 'For clips, ranked squads, and voice lobbies.',
      icon: <Gamepad2 className="w-5 h-5 text-[#35C98B]" />,
      defaultIcon: 'https://images.unsplash.com/photo-1542751371-adc38448a05e?w=120&auto=format&fit=crop&q=80',
    },
    {
      id: 'Education',
      name: 'School Club or Study Group',
      desc: 'For homework help, study rooms, and class schedules.',
      icon: <GraduationCap className="w-5 h-5 text-[#F59E0B]" />,
      defaultIcon: 'https://images.unsplash.com/photo-1518609878373-06d740f60d8b?w=120&auto=format&fit=crop&q=80',
    },
    {
      id: 'Friends',
      name: 'Friends & Family',
      desc: 'A cozy private space to hang out and share memes.',
      icon: <Users className="w-5 h-5 text-[#EC4899]" />,
      defaultIcon: 'https://images.unsplash.com/photo-1529156069898-49953e39b3ac?w=120&auto=format&fit=crop&q=80',
    },
    {
      id: 'Creators',
      name: 'Artists & Creators',
      desc: 'Showcase art, get feedback, and build a fandom.',
      icon: <Palette className="w-5 h-5 text-[#8B5CF6]" />,
      defaultIcon: 'https://images.unsplash.com/photo-1579783900882-c0d3dad7b119?w=120&auto=format&fit=crop&q=80',
    },
  ];

  const handleTemplateSelect = (template: typeof templates[0]) => {
    setSelectedTemplate(template.id);
    setServerName(`${template.name.split(' ')[0]}'s Server`);
    setServerIcon(template.defaultIcon);
    setStep(2);
  };

  const handleFinish = (e: React.FormEvent) => {
    e.preventDefault();
    const validation = validateServerName(serverName);
    if (!validation.valid) {
      setValidationError(validation.error || 'Invalid server name.');
      return;
    }

    createServer(serverName, selectedTemplate, serverIcon, selectedTemplate);
    closeModal();
    // Reset wizard
    setStep(1);
    setServerName('');
    setValidationError(null);
  };

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-[#191C24] border border-[#2b303d] rounded-3xl w-full max-w-md p-6 shadow-2xl relative select-none">
        {/* Header with Close */}
        <div className="flex items-center justify-between pb-3 border-b border-[#262A36]">
          {step > 1 ? (
            <button
              onClick={() => setStep((step - 1) as any)}
              className="p-1 text-[#9B9EAC] hover:text-white flex items-center gap-1 text-xs font-semibold"
            >
              <ChevronLeft className="w-4 h-4" /> Back
            </button>
          ) : (
            <div />
          )}
          <button
            onClick={closeModal}
            className="p-1 text-[#9B9EAC] hover:text-white rounded-lg"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Wizard Step 1: Choose Template */}
        {step === 1 && (
          <div className="space-y-4 pt-3">
            <div className="text-center">
              <h2 className="text-xl font-extrabold text-white">Create Your Server</h2>
              <p className="text-xs text-[#9B9EAC] mt-1">
                Your server is where you and your friends hang out. Make yours and start talking.
              </p>
            </div>

            <div className="space-y-2 max-h-[340px] overflow-y-auto pr-1">
              {templates.map(t => (
                <button
                  key={t.id}
                  onClick={() => handleTemplateSelect(t)}
                  className="w-full flex items-center justify-between p-3 rounded-2xl bg-[#111318] border border-[#262A36] hover:border-[#7667F7] hover:bg-[#15171e] transition-all text-left group"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-[#191C24] flex items-center justify-center">
                      {t.icon}
                    </div>
                    <div>
                      <p className="text-xs font-bold text-white group-hover:text-[#7667F7] transition-colors">
                        {t.name}
                      </p>
                      <p className="text-[10px] text-[#9B9EAC]">{t.desc}</p>
                    </div>
                  </div>
                  <ArrowRight className="w-4 h-4 text-[#717585] group-hover:text-white group-hover:translate-x-1 transition-all" />
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Wizard Step 2: Audience */}
        {step === 2 && (
          <div className="space-y-4 pt-3 text-center">
            <h2 className="text-xl font-extrabold text-white">Tell us more about your server</h2>
            <p className="text-xs text-[#9B9EAC]">
              In order to help you with your setup, is your new server for just a few friends or a larger community?
            </p>

            <div className="space-y-3 pt-2">
              <button
                onClick={() => {
                  setServerAudience('club');
                  setStep(3);
                }}
                className="w-full flex items-center justify-between p-4 rounded-2xl bg-[#111318] border border-[#262A36] hover:border-[#7667F7] text-left group"
              >
                <div>
                  <p className="text-xs font-bold text-white group-hover:text-[#7667F7]">
                    For a club or community
                  </p>
                  <p className="text-[10px] text-[#9B9EAC]">
                    Public server with open discovery, stages, and forum topics.
                  </p>
                </div>
                <ArrowRight className="w-4 h-4 text-[#717585] group-hover:text-white" />
              </button>

              <button
                onClick={() => {
                  setServerAudience('friends');
                  setStep(3);
                }}
                className="w-full flex items-center justify-between p-4 rounded-2xl bg-[#111318] border border-[#262A36] hover:border-[#7667F7] text-left group"
              >
                <div>
                  <p className="text-xs font-bold text-white group-hover:text-[#7667F7]">
                    For me and my friends
                  </p>
                  <p className="text-[10px] text-[#9B9EAC]">
                    Private server invite-only for daily gaming & banter.
                  </p>
                </div>
                <ArrowRight className="w-4 h-4 text-[#717585] group-hover:text-white" />
              </button>
            </div>
          </div>
        )}

        {/* Wizard Step 3: Customize Name & Icon */}
        {step === 3 && (
          <form onSubmit={handleFinish} className="space-y-4 pt-3">
            <div className="text-center">
              <h2 className="text-xl font-extrabold text-white">Customize Your Server</h2>
              <p className="text-xs text-[#9B9EAC] mt-1">
                Give your new server a personality with a name and an icon. You can always change it later.
              </p>
            </div>

            {/* Icon Uploader / Preview */}
            <div className="flex flex-col items-center">
              <div className="relative group w-20 h-20 rounded-full overflow-hidden border-2 border-dashed border-[#7667F7] hover:border-solid bg-[#111318] flex items-center justify-center cursor-pointer">
                <img
                  src={serverIcon}
                  alt="Server Icon Preview"
                  className="w-full h-full object-cover"
                />
                <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 flex flex-col items-center justify-center transition-opacity text-white text-[10px] font-bold">
                  <Upload className="w-4 h-4 mb-0.5" />
                  UPLOAD
                </div>
              </div>
            </div>

            {/* Server Name Input */}
            <div>
              <label className="block text-xs font-bold text-[#9B9EAC] uppercase tracking-wider mb-1">
                SERVER NAME
              </label>
              <input
                type="text"
                required
                value={serverName}
                onChange={e => {
                  setServerName(e.target.value);
                  setValidationError(null);
                }}
                className="w-full bg-[#111318] border border-[#262A36] focus:border-[#7667F7] rounded-xl px-3 py-2 text-xs text-white focus:outline-none"
              />
              {validationError && (
                <p className="text-[11px] text-[#EF4444] mt-1">{validationError}</p>
              )}
            </div>

            <p className="text-[10px] text-[#717585]">
              By creating a server, you agree to NEXORA's Community Guidelines.
            </p>

            <div className="flex justify-between items-center pt-2">
              <button
                type="button"
                onClick={() => setStep(2)}
                className="text-xs font-bold text-white hover:underline"
              >
                Back
              </button>
              <button
                type="submit"
                className="px-6 py-2 bg-[#7667F7] hover:bg-[#6353f4] text-xs font-bold text-white rounded-xl shadow-lg shadow-[#7667F7]/30 transition-all"
              >
                Create
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};
