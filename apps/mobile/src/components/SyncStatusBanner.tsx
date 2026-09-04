import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { WifiOff } from 'lucide-react-native';
import { useSyncStatus } from '../powersync/useSyncStatus';

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
    <View style={styles.banner}>
      <WifiOff size={15} color="#b45309" />
      <Text style={styles.text}>
        {errorMessage
          ? `Sync can't connect: ${errorMessage}`
          : "Sync can't connect — new changes may not appear until this reconnects."}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#fffbeb',
    borderWidth: 1,
    borderColor: '#fde68a',
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginBottom: 12,
  },
  text: {
    flex: 1,
    fontSize: 12,
    fontWeight: '600',
    color: '#b45309',
  },
});
