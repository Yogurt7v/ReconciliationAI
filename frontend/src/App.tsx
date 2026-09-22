import { useState } from 'react';

import { useModelSetting } from './hooks/useModelSetting';
import { SettingsButton } from './components/SettingsButton';
import { ModelModal } from './components/ModelModal';
import MainScreen from './screens/MainScreen';

export default function App() {
  const [model, setModel, apiKey, setApiKey] = useModelSetting();
  const [modalOpen, setModalOpen] = useState(false);

  const handleSaveSettings = (newModel: string, newApiKey: string) => {
    setModel(newModel);
    setApiKey(newApiKey);
  };

  return (
    <main className="page">
      <SettingsButton onClick={() => setModalOpen(true)} />
      <ModelModal
        open={modalOpen}
        model={model}
        apiKey={apiKey}
        onClose={() => setModalOpen(false)}
        onSave={handleSaveSettings}
      />
      <MainScreen model={model} apiKey={apiKey} />
    </main>
  );
}
