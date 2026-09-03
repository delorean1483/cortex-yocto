#include "bl_crc32.h"
uint32_t bl_crc32(const uint8_t *data, uint32_t len){
    uint32_t crc = 0xFFFFFFFFu;
    for(uint32_t i=0;i<len;i++){
        crc ^= data[i];
        for(int b=0;b<8;b++){ uint32_t m = (uint32_t)-(int32_t)(crc & 1u); crc = (crc>>1) ^ (0xEDB88320u & m); }
    }
    return crc ^ 0xFFFFFFFFu;
}
