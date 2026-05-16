import 'react-native-url-polyfill/auto';
import { createClient } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

// Utilize as variáveis de ambiente ou placeholders caso não estejam definidas
const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL || 'https://YOUR-SUPABASE-URL.supabase.co';
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || 'YOUR-ANON-KEY';

// No web, o Supabase já sabe usar o localStorage nativamente se não passarmos storage.
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: Platform.OS === 'web' ? undefined : AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});
