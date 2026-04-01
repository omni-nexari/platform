import LogViewer from '../../components/LogViewer.js';

export default function ManagementLogsPage() {
  return (
    <LogViewer
      apiPath="/logs"
      showOrgFilter={false}
      showPurge={false}
      title="Logs"
      subtitle="Device and dashboard logs for your organisations. Click 'Load Logs' to fetch."
    />
  );
}
