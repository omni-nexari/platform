import LogViewer from '../../components/LogViewer.js';

export default function PlatformLogsPage() {
  return (
    <LogViewer
      apiPath="/logs"
      showOrgFilter
      showPurge
      title="System Logs"
      subtitle="Aggregated logs from all sources. Click 'Load Logs' to fetch."
    />
  );
}
