import * as Notifications from 'expo-notifications';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import type { HealthRecordType } from './api';

// Lembretes locais da carteirinha de saúde. 100% client-side via expo-notifications
// (já instalado e com handler/canal configurados em hooks/use-push-notifications.ts).
// Best-effort: NUNCA lança no fluxo de salvar.

const STORAGE_KEY = 'health_reminder_ids_v1'; // map recordId -> notificationId
const DAYS_BEFORE = 3; // avisa X dias antes da próxima data
const HOUR_OF_DAY = 9; // às 9h no horário local

const TYPE_LABEL: Record<HealthRecordType, string> = {
  vacina: 'Vacina',
  vermifugo: 'Vermífugo',
  antipulgas: 'Antipulgas',
  medicacao: 'Medicação',
  peso: 'Pesagem',
};

// Serializa todo read-modify-write do mapa para evitar corrida (salvar+salvar /
// salvar+excluir quase simultâneos perderiam/órfãos um id).
let mapLock: Promise<unknown> = Promise.resolve();
function withMapLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = mapLock.then(fn, fn);
  mapLock = run.then(() => undefined, () => undefined);
  return run;
}

async function readMap(): Promise<Record<string, string>> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

async function writeMap(map: Record<string, string>): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    // best-effort
  }
}

function setMapEntry(recordId: string, notifId: string): Promise<void> {
  return withMapLock(async () => {
    const map = await readMap();
    map[recordId] = notifId;
    await writeMap(map);
  });
}

function takeMapEntry(recordId: string): Promise<string | undefined> {
  return withMapLock(async () => {
    const map = await readMap();
    const id = map[recordId];
    if (id) {
      delete map[recordId];
      await writeMap(map);
    }
    return id;
  });
}

// Só agenda se a permissão JÁ foi concedida (o registro de push pede no login).
// Não dispara o diálogo no meio do salvamento — recurso é bônus, best-effort.
async function hasPermission(): Promise<boolean> {
  try {
    const { status } = await Notifications.getPermissionsAsync();
    return status === 'granted';
  } catch {
    return false;
  }
}

/** Cancela o lembrete previamente agendado para o registro (se houver). */
export async function cancelHealthReminder(recordId: string): Promise<void> {
  try {
    const notifId = await takeMapEntry(recordId);
    if (notifId) {
      await Notifications.cancelScheduledNotificationAsync(notifId).catch(() => {});
    }
  } catch {
    // best-effort
  }
}

/**
 * Agenda (ou reagenda) o lembrete de um registro de saúde para X dias antes da
 * próxima data, às 9h. Sempre cancela o anterior antes. Se a próxima data for
 * vazia ou o disparo já tiver passado, só limpa o lembrete antigo (não agenda no
 * passado). Best-effort — degrada em silêncio se não houver permissão.
 */
export async function scheduleHealthReminder(params: {
  recordId: string;
  meuPetId: string;
  petName: string;
  type: HealthRecordType;
  proximaData: string | null; // 'YYYY-MM-DD'
}): Promise<void> {
  const { recordId, meuPetId, petName, type, proximaData } = params;
  try {
    // Sempre cancela o anterior antes de reagendar (cobre edição/exclusão).
    await cancelHealthReminder(recordId);
    if (!proximaData) return;

    const due = new Date(`${proximaData}T00:00:00`);
    if (Number.isNaN(due.getTime())) return;

    const fire = new Date(due);
    fire.setDate(fire.getDate() - DAYS_BEFORE);
    fire.setHours(HOUR_OF_DAY, 0, 0, 0);
    if (fire.getTime() <= Date.now()) return; // nunca agenda no passado

    if (!(await hasPermission())) return;

    const label = TYPE_LABEL[type] ?? 'Cuidado';
    const dueLabel = format(due, "dd 'de' MMMM", { locale: ptBR });

    const notifId = await Notifications.scheduleNotificationAsync({
      content: {
        title: `Lembrete · ${petName}`,
        body: `${label} vence em ${dueLabel}. Toque para abrir a carteirinha.`,
        data: { type: 'health_reminder', meuPetId, recordId },
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: fire,
        ...(Platform.OS === 'android' ? { channelId: 'default' } : {}),
      },
    });

    await setMapEntry(recordId, notifId);
  } catch {
    // best-effort — não trava o salvamento
  }
}
