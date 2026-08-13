<#macro kw color="">
  <#switch color>
    <#case "error">
      <#assign colorClass="border border-red-200 bg-red-50 text-red-700 dark:border-red-900/70 dark:bg-red-950/40 dark:text-red-200">
      <#break>
    <#case "info">
      <#assign colorClass="border border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-900/70 dark:bg-blue-950/40 dark:text-blue-200">
      <#break>
    <#case "success">
      <#assign colorClass="border border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/70 dark:bg-emerald-950/40 dark:text-emerald-200">
      <#break>
    <#case "warning">
      <#assign colorClass="border border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/70 dark:bg-amber-950/40 dark:text-amber-200">
      <#break>
    <#default>
      <#assign colorClass="border border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-900/70 dark:bg-blue-950/40 dark:text-blue-200">
  </#switch>

  <div class="${colorClass} rounded-xl p-4 text-sm" role="alert">
    <#nested>
  </div>
</#macro>
