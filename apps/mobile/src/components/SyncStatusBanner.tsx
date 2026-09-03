import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { WifiOff } from 'lucide-react-native';
import { useSyncStatus } from '../powersync/useSyncStatus';

// Renders nothing when sync is healthy. Shows a warning when there's a
// concrete download error (e.g. a rejected JWT), or when the connection has
// been down for more than a few seconds -- long enough to rule out a normal
// app-resume/network blip, short enough that a real outage doesn't sit
// invisible while things like "new member" or "new category" quietly fail
// to show up with no explanation anywhere in the UI.
export default function SyncStatusBanner() {
  const { connected, errorMessage } = useSyncStatus();
  const [showDisconnected, setShowDisconnected] = useState(false);

  useEffect(() => {
    if (connected) {
      setShowDisconnected(false);
      return;
    }
    const timer = setTimeout(() => setShowDisconnected(true), 8000);
    return () => clearTimeout(timer);
  }, [connected]);

  if (!errorMessage && !showDisconnected) return null;

  return (
    <View className="flex-row items-center gap-2 bg-amber-50 border border-amber-200 rounded-2xl px-3.5 py-2.5 mb-3">
      <WifiOff size={15} color="#b45309" />
      <Text className="flex-1 text-xs font-semibold text-amber-800">
        {errorMessage
          ? `Sync can't connect: ${errorMessage}`
          : "Sync can't connect — new changes may not appear until this reconnects."}
      </Text>
    </View>
  );
}
