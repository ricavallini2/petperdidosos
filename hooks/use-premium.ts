import { useState, useCallback } from 'react';
import { useFocusEffect } from 'expo-router';
import { useAuth } from '../contexts/AuthContext';
import { getPremiumStatus, PremiumStatus } from '../services/api';

const DEFAULT_STATUS: PremiumStatus = {
  isPremium: false,
  expiresAt: null,
  plan: null,
  aiSearchesLeft: 5,
  aiSearchesUsed: 0,
  aiSearchesLimit: 5,
  premiumSettings: {
    rewardMinAmount: 0,
    rewardMaxAmount: null,
    alertEnabled: true,
    highlightOnMap: true,
  },
};

export function usePremium() {
  const { user } = useAuth();
  const [status, setStatus] = useState<PremiumStatus>(DEFAULT_STATUS);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!user) return;
    try {
      const data = await getPremiumStatus(user.id);
      setStatus(data);
    } catch (e) {
      console.warn('Erro ao carregar status premium', e);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  return { ...status, loading, reload: load };
}
