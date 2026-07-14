SELECT name, firmware_version, status, last_seen
FROM devices
WHERE firmware_version LIKE 'T-KTM%'
ORDER BY last_seen DESC
LIMIT 3;
