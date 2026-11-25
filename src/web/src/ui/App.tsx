import '@fontsource-variable/noto-nastaliq-urdu';
import '@fontsource-variable/noto-naskh-arabic';
import './styles/base.css';
import './styles/layout.css';

import { useEffect, useState } from 'react';

import { Banners } from './components/Banners';
import { ChannelPanel } from './components/ChannelPanel';
import { Composer } from './components/Composer';
import { Header } from './components/Header';
import { SettingsDialog, type SettingsTab } from './components/SettingsDialog';
import { SetupGuide } from './components/SetupGuide';
import { Toasts } from './components/Toasts';
import { Transcript } from './components/Transcript';
import { controller } from './controller';
import { isDemo, loadDemo } from './demo';
import { useAppearance } from './hooks/useAppearance';
import { usePushToTalk } from './hooks/usePushToTalk';

// React's StrictMode mounts components twice in development; start the engine only once.
let started = false;

type OpenDialog = 'settings' | 'guide' | null;

export function App() {
  const [dialog, setDialog] = useState<OpenDialog>(null);
  const [settingsTab, setSettingsTab] = useState<SettingsTab>('keys');
  useAppearance();
  usePushToTalk();

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
  const close = () => setDialog(null);

  // A modal dialog makes the page inert, so each dialog carries its own copy of the toasts.
  const dialogToasts = <Toasts placement="dialog" />;

  return (
    <div className="app">
      <Header onOpenGuide={() => setDialog('guide')} onOpenSettings={() => openSettings(settingsTab)} />
      <Banners onOpenKeys={() => openSettings('keys')} />
      <main className="workspace">
        <div className="sidebar">
          <ChannelPanel channel="outgoing" />
          <ChannelPanel channel="incoming" />
        </div>
        <div className="reading">
          <Transcript onOpenGuide={() => setDialog('guide')} />
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
    </div>
  );
}
