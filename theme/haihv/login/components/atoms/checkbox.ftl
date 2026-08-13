<#macro kw checked=false label="" name="" rest...>
  <div class="flex items-center">
    <input
      <#if checked>checked</#if>

      class="h-4 w-4 rounded border-slate-300 bg-white text-primary-600 shadow-sm focus:ring-primary-200 dark:border-slate-600 dark:bg-slate-900 dark:focus:ring-primary-500/30"
      id="${name}"
      name="${name}"
      type="checkbox"

      <#list rest as attrName, attrValue>
        ${attrName}="${attrValue}"
      </#list>
    >
    <label class="ml-2 text-sm text-slate-600 dark:text-slate-300" for="${name}">
      ${label}
    </label>
  </div>
</#macro>
