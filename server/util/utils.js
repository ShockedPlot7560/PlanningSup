const ical = require('cal-parser')
const dayjs = require('dayjs')
const { Planning } = require('../models/planning')
const { CustomEvent } = require('../models/customevent')
const logger = require('./signale')

const dateStartTemplate = '{date-start}'
const dateEndTemplate = '{date-end}'

let curl

/**
 * Check if includes template
 */
const includesTemplate = v => v && (v.includes(dateStartTemplate) || v.includes(dateEndTemplate))

/**
 * Get appropriate color for event
 * @param value
 * @param location
 * @param customColor
 * @returns {string}
 */
const getColor = (value, location, customColor) => {
  if (value.includes('CM') || value.toUpperCase().includes('AMPHI') || location.toUpperCase().includes('AMPHI')) {
    return customColor?.amphi || '#efd6d8'
  } else if (value.includes('TP') || value.includes('TDi') || value.trim().match(/\sG\d\.\d$/)) {
    return customColor?.tp || '#bbe0ff'
  } else if ((value.includes('TD') || location.includes('V-B') || value.trim().match(/\sG\d$/)) && !/^S\d\.\d\d/.test(value) && !/contr[ôo]le/i.test(value)) {
    return customColor?.td || '#d4fbcc'
  } else {
    return customColor?.other || '#EDDD6E'
  }
}

/**
 * Sanitize description
 * @param d
 * @returns {string}
 */
const cleanDescription = d => d && d
  .replace(/Grp \d/g, '')
  .replace(/GR \d.?\d?/g, '')
  .replace(/LP (DLIS|CYBER)/g, '')
  .replace(/\(Exporté.*\)/, '')
  .replace(/\(Exported :.*\)/, '')
  .replace(/\(Updated :.*\)/, '')
  .replace(/\(Modifié le:.*\)/, '')
  .trim()

/**
 * Sanitize description
 * @param l
 * @returns {string}
 */
const cleanLocation = l => l && l.trim()
  .replace('salle joker à distance', 'À distance')
  .replace(/(?:\.\.\. MOODLE,)?\.\.a Séance à distance asynchrone-/, 'À distance')
  .split(',').map(v => v.replace(/^V-/, '')).join(', ')

/**
 * Sanitize event name
 * @param name
 * @returns {*}
 */
const cleanName = name => (name && name.replace(/([A-Za-z])\?([A-Za-z])/gi, (_, b, c) => b + "'" + c).trim()) || ''

module.exports = {
  /**
   * Get custom events for a planning
   * @param name
   * @returns array custom events
   */
  getCustomEventContent: async (name) => {
    try {
      const data = await CustomEvent.findOne({ name })
      return data?.content || ''
    } catch (err) {
      logger.error(err)
      return ''
    }
  },
  /**
   * Get backed plannings
   * @returns {Promise<[]|*|{backup: ([]|*), timestamp}|null>}
   * @param fullId
   */
  getBackedPlanning: async (fullId) => {
    try {
      const tmpPlanning = await Planning.findOne({ fullId })
      return tmpPlanning && tmpPlanning.backup && { backup: tmpPlanning.backup, timestamp: tmpPlanning.timestamp }
    } catch (err) {
      return null
    }
  },
  /**
   * Get formatted json
   * @param j
   * @param blocklist
   * @param colors
   * @returns {*[]}
   */
  getFormattedEvents: (j, blocklist, colors) => {
    const events = []
    for (const i of j.events || j) {
      if (!blocklist.some(str => i.summary.value.toUpperCase().includes(str))) {
        events.push({
          name: cleanName(i.summary.value),
          start: new Date(i.dtstart.value).getTime(),
          end: new Date(i.dtend.value).getTime(),
          color: getColor(i.summary.value, i.location.value, colors),
          location: cleanLocation(i.location.value),
          description: cleanDescription(i.description.value),
          distance: /à distance$|EAD/.test(i.location.value.trim()) || undefined,
          timed: true
        })
      }
    }
    return events
  },
  /**
   * Fetch planning from URL, convert ICS to JSON
   * @param {String} url
   * @param instance (axios, curl, ...)
   * @returns {Promise<*>}
   */
  fetchAndGetJSON: async (url, instance) => {
    if (includesTemplate(url)) {
      url = url
        .replace(dateStartTemplate, encodeURIComponent(dayjs().subtract(1, 'month').format('YYYY-MM-DD')))
        .replace(dateEndTemplate, encodeURIComponent(dayjs().add(2, 'years').format('YYYY-MM-DD')))
    }

    if (!instance && !curl) {
      logger.info('Initializing curl')
      curl = require('./curl')
    }
    try {
      const { data } = instance ? await instance.get(url) : await curl.get(url)
      if (data && data.length && !data.includes('500 Internal Server Error') && !data.includes('<!DOCTYPE ')) { // Yeah, that's perfectible
        const ics = ical.parseString(data)
        if (ics && Object.entries(ics).length) {
          return ics
        }
      } else {
        logger.debug(data)
      }
    } catch (e) {
      logger.debug(e)
    }
  }
}
