import '@fontsource-variable/atkinson-hyperlegible-next';
// The standard axes (weight, width, slant), which the titles and the empty page move along.
import '@fontsource-variable/roboto-flex/standard.css';
import '@fontsource-variable/martian-mono';
import '@fontsource-variable/noto-nastaliq-urdu';
import '@fontsource-variable/noto-naskh-arabic';
import './styles/base.css';
import './styles/layout.css';

import { RotateCcw } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import type { ChannelId } from '../../../shared/settings';
import { Banners } from './components/Banners';
import { ChannelPanel, DevicesSheet } from './components/ChannelPanel';
import { Composer } from './components/Composer';
import { Header } from './components/Header';
import { SettingsDialog, type SettingsTab } from './components/SettingsDialog';
import { SetupGuide } from './components/SetupGuide';
import { Telemetry } from './components/Telemetry';
import { Toasts } from './components/Toasts';
import { Transcript } from './components/Transcript';
import { VoiceField } from './components/VoiceField';
import { controller } from './controller';
import { isDemo, loadDemo, replaySample } from './demo';
import { useAppearance } from './hooks/useAppearance';
import { useEntrance } from './hooks/useEntrance';
import { usePushToTalk } from './hooks/usePushToTalk';

// React's StrictMode mounts components twice in development; start the engine only once.
let started = false;

type OpenDialog = 'settings' | 'guide' | `devices-${ChannelId}` | null;

const CHANNELS: readonly ChannelId[] = ['outgoing', 'incoming'];

export function App() {
  const [dialog, setDialog] = useState<OpenDialog>(null);
  const [settingsTab, setSettingsTab] = useState<SettingsTab>('keys');
  const page = useRef<HTMLDivElement>(null);
  useAppearance();
  usePushToTalk();
  useEntrance(page);

  useEffect(() => {
    if (started) return;
    started = true;
    if (isDemo()) loadDemo();
    else void controller().init();
  }, []);

  const openSettings = (tab: SettingsTab) => {
    setSettingsTab(tab);
    setDialog('settings');
  };
  const openGuide = () => setDialog('guide');
  const close = () => setDialog(null);

  // A modal dialog makes the page inert, so each dialog carries its own copy of the toasts.
  const dialogToasts = <Toasts placement="dialog" />;

  return (
    <div className="app" ref={page}>
      <Header onOpenGuide={openGuide} onOpenSettings={() => openSettings(settingsTab)} />
      <Banners onOpenKeys={() => openSettings('keys')} />
      <main className="workspace">
        {/* Your side, the measurements, their side, over the surface both voices travel on. */}
        <div className="console">
          <VoiceField />
          <ChannelPanel
            channel="outgoing"
            onOpenDevices={() => setDialog('devices-outgoing')}
            onOpenGuide={openGuide}
          />
          <Telemetry />
          <ChannelPanel
            channel="incoming"
            onOpenDevices={() => setDialog('devices-incoming')}
            onOpenGuide={openGuide}
          />
        </div>
        <div className="reading">
          <Transcript
            onOpenGuide={openGuide}
            toolbarExtra={
              isDemo() ? (
                <button className="button button--quiet button--small" type="button" onClick={replaySample}>
                  <RotateCcw size={14} aria-hidden="true" /> Replay sample
                </button>
              ) : null
            }
          />
          <Composer />
          <Toasts placement="page" covered={dialog !== null} />
        </div>
      </main>

      <SettingsDialog
        open={dialog === 'settings'}
        tab={settingsTab}
        onTabChange={setSettingsTab}
        onClose={close}
        overlay={dialogToasts}
      />
      <SetupGuide open={dialog === 'guide'} onClose={close} overlay={dialogToasts} />
      {CHANNELS.map((channel) => (
        <DevicesSheet
          key={channel}
          channel={channel}
          open={dialog === `devices-${channel}`}
          onClose={close}
          overlay={dialogToasts}
        />
      ))}
    </div>
  );
}
