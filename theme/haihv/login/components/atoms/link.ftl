<#macro kw color="" component="a" size="" rest...>
  <#switch color>
    <#case "primary">
      <#assign colorClass="text-primary-600 hover:text-primary-500 dark:text-primary-400 dark:hover:text-primary-300">
      <#break>
    <#case "secondary">
      <#assign colorClass="text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white">
      <#break>
    <#default>
      <#assign colorClass="text-primary-600 hover:text-primary-500 dark:text-primary-400 dark:hover:text-primary-300">
  </#switch>

  <#switch size>
    <#case "small">
      <#assign sizeClass="text-sm">
      <#break>
    <#default>
      <#assign sizeClass="">
  </#switch>

  <${component}
    class="<#compress>${colorClass} ${sizeClass} inline-flex transition-colors</#compress>"

    <#list rest as attrName, attrValue>
      ${attrName}="${attrValue}"
    </#list>
  >
    <#nested>
  </${component}>
</#macro>
