import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import type { ReminderScheduler, ScheduledReminder } from './reminderService';

const CHANNEL_ID = 'recordatorios';

// Con la app abierta el aviso también se muestra (si no, un recordatorio que llega mientras se usa la app pasaría desapercibido).
Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false }),
});

/**
 * Avisos locales del sistema con expo-notifications (SPEC-notify-001): programados en el teléfono, sin servidor push. En Android hace
 * falta un canal; en Android 13 o posterior el permiso se pide al activar un recordatorio. Los avisos se programan uno por uno
 * (fecha concreta), no repetidos.
 */
export class NotificationsScheduler implements ReminderScheduler {
  async permission(): Promise<'granted' | 'denied' | 'undetermined'> {
    const { status } = await Notifications.getPermissionsAsync();
    return status;
  }

  async requestPermission(): Promise<boolean> {
    // En Android 13 el aviso del sistema no aparece hasta que existe un canal.
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync(CHANNEL_ID, { name: 'Recordatorios', importance: Notifications.AndroidImportance.DEFAULT });
    }
    return (await Notifications.requestPermissionsAsync()).granted;
  }

  cancelAll(): Promise<void> {
    return Notifications.cancelAllScheduledNotificationsAsync();
  }

  async schedule(reminder: ScheduledReminder): Promise<void> {
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync(CHANNEL_ID, { name: 'Recordatorios', importance: Notifications.AndroidImportance.DEFAULT });
    }
    await Notifications.scheduleNotificationAsync({
      content: { title: reminder.title, body: reminder.body, data: { route: reminder.route } },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: reminder.at, channelId: CHANNEL_ID },
    });
  }

  onTap(handler: (route: string) => void): () => void {
    const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
      const route = response.notification.request.content.data?.route;
      if (typeof route === 'string') handler(route);
    });
    return () => subscription.remove();
  }
}
