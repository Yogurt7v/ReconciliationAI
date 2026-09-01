import { useState } from 'react';

import { useModelSetting } from './hooks/useModelSetting';
import { SettingsButton } from './components/SettingsButton';
import { ModelModal } from './components/ModelModal';
import MainScreen from './screens/MainScreen';

export default function App() {
  const [model, setModel] = useModelSetting();
  const [modalOpen, setModalOpen] = useState(false);

  return (
    <main className="page">
      <SettingsButton onClick={() => setModalOpen(true)} />
      <ModelModal
        open={modalOpen}
        model={model}
        onClose={() => setModalOpen(false)}
        onSave={setModel}
      />
      <MainScreen model={model} />
    </main>
  );
}
