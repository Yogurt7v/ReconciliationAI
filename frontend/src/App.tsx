import React, { useState } from 'react';
import { MainScreen } from './components/MainScreen';
import { ModelModal } from './components/ModelModal';
import { useModelSetting } from './hooks/useModelSetting';

function App() {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [model, setModel, apiKey, setApiKey] = useModelSetting();

  const handleSaveSettings = (newModel: string, newApiKey: string) => {
    setModel(newModel);
    setApiKey(newApiKey);
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <MainScreen
        onOpenSettings={() => setIsModalOpen(true)}
        currentModel={model}
        apiKey={apiKey}
      />

      <ModelModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        currentModel={model}
        currentApiKey={apiKey}
        onSave={handleSaveSettings}
      />
    </div>
  );
}

export default App;
