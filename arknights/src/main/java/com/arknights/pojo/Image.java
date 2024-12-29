package com.arknights.pojo;

import lombok.Data;
import lombok.ToString;

@Data
@ToString
public class Image {
  public Integer id;
  public String name;
  public String icon; 
  public String cover;
  public String name_en;
  public String info;
  public String type;
  public Integer shift;
}
