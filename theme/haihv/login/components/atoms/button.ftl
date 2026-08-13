<#macro kw color="" component="button" size="" rest...>
  <#switch color>
    <#case "primary">
      <#assign colorClass="bg-primary-600 text-white shadow-sm hover:bg-primary-500 focus:ring-primary-500">
      <#break>
    <#case "secondary">
      <#assign colorClass="bg-slate-100 text-slate-700 hover:bg-slate-200 hover:text-slate-900 focus:ring-slate-400 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700 dark:hover:text-white">
      <#break>
    <#default>
      <#assign colorClass="bg-primary-600 text-white shadow-sm hover:bg-primary-500 focus:ring-primary-500">
  </#switch>

  <#switch size>
    <#case "medium">
      <#assign sizeClass="px-4 py-2.5 text-sm font-medium">
      <#break>
    <#case "small">
      <#assign sizeClass="px-2.5 py-1.5 text-xs font-medium">
      <#break>
    <#default>
      <#assign sizeClass="px-4 py-2.5 text-sm font-medium">
  </#switch>

  <${component}
    class="${colorClass} ${sizeClass} relative flex w-full justify-center rounded-xl focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-white transition-colors duration-200 dark:focus:ring-offset-slate-900"

    <#list rest as attrName, attrValue>
      ${attrName}="${attrValue}"
    </#list>
  >
    <#nested>
  </${component}>
</#macro>
