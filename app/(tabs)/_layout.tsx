import { Tabs } from 'expo-router';
import React from 'react';
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { HapticTab } from '@/components/haptic-tab';

export default function TabLayout() {
  const insets = useSafeAreaInsets();

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: '#FF4757',
        tabBarInactiveTintColor: '#A4B0BE',
        headerShown: false,
        tabBarButton: HapticTab,
        // Barra contínua estilo WhatsApp: encostada na base e em largura total.
        // O fundo branco se estende atrás do menu do sistema (transparente via
        // edge-to-edge) e o conteúdo fica acima dele pelo paddingBottom = inset.
        tabBarStyle: {
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: '#FFFFFF',
          height: 64 + insets.bottom,
          paddingBottom: insets.bottom,
          paddingTop: 8,
          borderTopWidth: StyleSheet.hairlineWidth,
          borderTopColor: '#ECECEC',
          elevation: 8,
          shadowColor: '#000',
          shadowOffset: { width: 0, height: -3 },
          shadowOpacity: 0.06,
          shadowRadius: 8,
        },
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: '600',
          marginTop: -2,
          marginBottom: 6,
        }
      }}>
      {/* Ordem da barra: SOS · Chats · Alertar(centro) · Meus Pets · Perfil */}
      <Tabs.Screen
        name="index"
        options={{
          title: 'SOS',
          tabBarIcon: ({ color, focused }) => (
            <Ionicons name={focused ? "navigate-circle" : "navigate-circle-outline"} size={27} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="chats"
        options={{
          title: 'Chats',
          tabBarIcon: ({ color, focused }) => (
            <Ionicons name={focused ? "chatbubbles" : "chatbubbles-outline"} size={26} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="report"
        options={{
          title: 'Alertar',
          tabBarIcon: ({ color, focused }) => (
            <Ionicons name={focused ? "megaphone" : "megaphone-outline"} size={26} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="meus-pets"
        options={{
          title: 'Meus Pets',
          tabBarIcon: ({ color, focused }) => (
            <Ionicons name={focused ? "paw" : "paw-outline"} size={26} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Perfil',
          tabBarIcon: ({ color, focused }) => (
            <Ionicons name={focused ? "person" : "person-outline"} size={26} color={color} />
          ),
        }}
      />

      {/* Rotas acessadas por push (fora da barra): Lista de alertas e Doação.
          Continuam existindo, só não ocupam slot no menu inferior. */}
      <Tabs.Screen name="alertas" options={{ href: null }} />
      <Tabs.Screen name="doacao" options={{ href: null }} />
    </Tabs>
  );
}
