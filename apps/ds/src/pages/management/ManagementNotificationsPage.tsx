import PortalNotificationsPage from '../../components/PortalNotificationsPage.js';

export default function ManagementNotificationsPage() {
  return (
    <PortalNotificationsPage
      title="Notifications"
      subtitle="Threshold-routed analytics alerts for your reseller portfolio."
      analyticsPath="/management/analytics"
    />
  );
}