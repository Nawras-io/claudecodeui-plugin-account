import { useTranslation } from 'react-i18next';
import { usePlugins } from '../../../../contexts/PluginsContext';
import PluginTabContent from '../../../plugins/view/PluginTabContent';

const ACCOUNT_PLUGIN = 'account';

export default function AccountSettingsTab() {
  const { t } = useTranslation('settings');
  const { plugins, loading } = usePlugins();
  const plugin = plugins.find((p) => p.name === ACCOUNT_PLUGIN);

  if (loading) {
    return null;
  }

  if (!plugin || !plugin.enabled) {
    return (
      <div className="rounded-lg border border-border bg-muted/30 p-6 text-sm text-muted-foreground">
        {t('account.unavailable', {
          defaultValue: !plugin
            ? 'Account plugin is not installed.'
            : 'Account plugin is disabled. Enable it from the Plugins tab.',
        })}
      </div>
    );
  }

  return (
    <PluginTabContent
      pluginName={ACCOUNT_PLUGIN}
      selectedProject={null}
      selectedSession={null}
    />
  );
}
